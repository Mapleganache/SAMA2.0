#!/usr/bin/env python3
"""Portable layered machine-tool knowledge base and circuit planning agent."""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import http.server
import html
import json
import mimetypes
import os
import re
import shutil
import sqlite3
import sys
import tempfile
import threading
import time
import unicodedata
import urllib.parse
import uuid
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


APP_VERSION = "1.1.0"
API_VERSION = "v1"
HERE = Path(__file__).resolve().parent
WORKSPACE = HERE.parent
DEFAULT_PACKAGE = HERE / "数据库包"
DEFAULT_BOOK = WORKSPACE / "数控机床故障诊断与维修实例宝典_MD"
DEFAULT_LEGACY = WORKSPACE / "机床智能体知识库v1"
DEFAULT_CIRCUIT_SOURCES = WORKSPACE / "参考资料"

DB_NAMES = {
    "common": "共通数据库.sqlite3",
    "equipment": "专有数据库/设备数据库.sqlite3",
    "circuit": "专有数据库/电路数据库.sqlite3",
}

TEXT_EXTENSIONS = {
    ".md", ".txt", ".csv", ".json", ".xml", ".sql", ".py", ".ini",
    ".lst", ".src", ".ref", ".rel", ".dat", ".msgxml", ".itemxml",
}

CIRCUIT_WORDS = (
    "电路", "电气", "接线", "伺服", "电机", "电动机", "驱动", "变频", "主轴",
    "plc", "pmc", "lad", "梯形图", "继电器", "接触器", "断路器", "熔断器",
    "电阻", "电容", "编码器", "24v", "380v", "io", "i/o", "急停", "sto",
    "母线", "制动", "电源", "端子", "线圈", "屏蔽", "接地", "变压器",
)

DOMAIN_RULES = [
    ("电路", CIRCUIT_WORDS),
    ("CNC/NC", ("cnc", "nc", "数控系统", "参数", "g代码", "g-code", "加工程序")),
    ("机械", ("机械", "轴承", "丝杠", "导轨", "齿轮", "刀库", "换刀", "振动", "精度")),
    ("液压气动", ("液压", "气动", "油压", "气压", "电磁阀", "泵")),
    ("HMI", ("hmi", "picture", "fp2", "画面", "控件", "脚本")),
]

SCHEMA = """
PRAGMA foreign_keys=ON;
CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE documents(
  id TEXT PRIMARY KEY,
  source_collection TEXT NOT NULL,
  source_path TEXT NOT NULL,
  title TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('共通','专有')),
  domain TEXT NOT NULL,
  machine_type TEXT,
  brand TEXT,
  model TEXT,
  media_type TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  verification_status TEXT NOT NULL,
  asset_id TEXT,
  imported_at TEXT NOT NULL,
  UNIQUE(source_collection, source_path)
);
CREATE TABLE chunks(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  heading TEXT,
  content TEXT NOT NULL,
  domain TEXT NOT NULL,
  machine_type TEXT,
  brand TEXT,
  model TEXT,
  image_refs TEXT NOT NULL DEFAULT '[]',
  UNIQUE(document_id, ordinal)
);
CREATE TABLE assets(
  id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL UNIQUE,
  media_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  content BLOB NOT NULL
);
CREATE INDEX idx_documents_domain ON documents(domain, machine_type, brand, model);
CREATE INDEX idx_chunks_document ON chunks(document_id, ordinal);
CREATE VIRTUAL TABLE chunk_fts USING fts5(
  heading, content, content='chunks', content_rowid='id', tokenize='unicode61'
);
CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunk_fts(rowid, heading, content) VALUES(new.id, new.heading, new.content);
END;
CREATE TRIGGER chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunk_fts(chunk_fts, rowid, heading, content)
  VALUES('delete', old.id, old.heading, old.content);
END;
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def stable_id(prefix: str, *values: str) -> str:
    raw = "\x1f".join(values).encode("utf-8")
    return f"{prefix}-{hashlib.sha256(raw).hexdigest()[:20]}"


def normalize_text(value: str) -> str:
    return unicodedata.normalize("NFKC", value).lower().strip()


def read_text_file(path: Path) -> str | None:
    data = path.read_bytes()
    if b"\x00" in data[:4096]:
        return None
    for encoding in ("utf-8-sig", "utf-8", "gb18030", "latin-1"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return None


def guess_domain(text: str) -> str:
    value = normalize_text(text)
    scores = [(domain, sum(value.count(word) for word in words)) for domain, words in DOMAIN_RULES]
    domain, score = max(scores, key=lambda item: item[1])
    return domain if score else "综合"


def infer_machine_metadata(path_text: str) -> tuple[str | None, str | None, str | None]:
    text = normalize_text(path_text)
    machine = None
    for key, label in (
        ("无心", "无心磨床"), ("外圆", "外圆磨床"), ("内圆", "内圆磨床"),
        ("平面", "平面磨床"), ("磨床", "磨床"), ("车床", "车床"),
        ("加工中心", "加工中心"), ("铣床", "铣床"), ("镗床", "镗床"),
    ):
        if key in text:
            machine = label
            break
    brand = None
    for key, label in (
        ("fanuc", "FANUC"), ("法那科", "FANUC"), ("siemens", "SIEMENS"),
        ("西门子", "SIEMENS"), ("studer", "STUDER"), ("斯图特", "STUDER"),
        ("mikrosa", "MIKROSA"), ("米克罗莎", "MIKROSA"),
        ("favretto", "FAVRETTO"), ("法力图", "FAVRETTO"),
        ("mitsui", "MITSUI"), ("三井", "MITSUI"),
        ("toyoda", "TOYODA/JTEKT"), ("丰田", "TOYODA/JTEKT"),
    ):
        if key in text:
            brand = label
            break
    model = None
    for pattern in (r"\bs40-?4\b", r"\bsasl3[/_-]?2(?:-cnc)?\b", r"\b0i-?[fmt]?[cf]?\b"):
        match = re.search(pattern, text, re.I)
        if match:
            model = match.group(0).upper()
            break
    return machine, brand, model


def split_text(text: str, max_chars: int = 2200, overlap: int = 180) -> list[tuple[str, str, list[str]]]:
    """Split Markdown/plain text, preserving headings and nearby image references."""
    heading = "正文"
    sections: list[tuple[str, str]] = []
    buffer: list[str] = []
    heading_re = re.compile(r"^#{1,6}\s+(.+?)\s*$")
    case_re = re.compile(r"^\s*实例\s*\d+\s*.+")
    for line in text.splitlines():
        heading_match = heading_re.match(line)
        if heading_match or case_re.match(line):
            if buffer:
                sections.append((heading, "\n".join(buffer).strip()))
                buffer = []
            heading = heading_match.group(1).strip() if heading_match else line.strip()
        else:
            buffer.append(line)
    if buffer:
        sections.append((heading, "\n".join(buffer).strip()))

    result: list[tuple[str, str, list[str]]] = []
    image_re = re.compile(r"(?:!\[[^]]*\]\(|<img\s+[^>]*src=[\"'])([^\"')>]+)", re.I)
    for section_heading, body in sections:
        body = body.strip()
        if not body:
            continue
        start = 0
        while start < len(body):
            end = min(len(body), start + max_chars)
            if end < len(body):
                boundary = max(body.rfind("\n\n", start, end), body.rfind("。", start, end))
                if boundary > start + max_chars // 2:
                    end = boundary + 1
            piece = body[start:end].strip()
            if piece:
                refs = [match.group(1) for match in image_re.finditer(piece)]
                result.append((section_heading, piece, refs))
            if end >= len(body):
                break
            start = max(start + 1, end - overlap)
    return result


@dataclass
class PackagePaths:
    root: Path

    def db(self, kind: str) -> Path:
        return self.root / DB_NAMES[kind]

    @property
    def memory(self) -> Path:
        return self.root / ".memory" / "agent_memory.jsonl"

    @property
    def manifest(self) -> Path:
        return self.root / "manifest.json"


def connect_db(path: Path, readonly: bool = False) -> sqlite3.Connection:
    if readonly:
        uri = f"file:{urllib.parse.quote(str(path))}?mode=ro"
        connection = sqlite3.connect(uri, uri=True)
    else:
        connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_db(path: Path, kind: str) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    connection.executescript(SCHEMA)
    connection.executemany(
        "INSERT INTO meta(key,value) VALUES(?,?)",
        (("schema_version", "1"), ("database_kind", kind), ("created_at", now_iso())),
    )
    return connection


class Builder:
    def __init__(self, target: Path):
        self.target = PackagePaths(target)
        self.connections: dict[str, sqlite3.Connection] = {}
        self.stats = {kind: {"documents": 0, "chunks": 0, "assets": 0, "bytes": 0} for kind in DB_NAMES}

    def __enter__(self) -> "Builder":
        self.target.root.mkdir(parents=True, exist_ok=True)
        self.connections = {kind: initialize_db(self.target.db(kind), kind) for kind in DB_NAMES}
        return self

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        for connection in self.connections.values():
            if exc_type:
                connection.rollback()
            else:
                connection.commit()
                connection.execute("PRAGMA journal_mode=DELETE")
                connection.execute("VACUUM")
            connection.close()

    def add_file(
        self,
        path: Path,
        collection_root: Path,
        collection: str,
        kind: str,
        scope: str,
        forced_domain: str | None = None,
    ) -> None:
        relative = path.relative_to(collection_root).as_posix()
        if path.name == ".DS_Store" or path.name.startswith("~$"):
            return
        data = path.read_bytes()
        digest = sha256_bytes(data)
        text = read_text_file(path) if path.suffix.lower() in TEXT_EXTENSIONS else None
        sample = f"{relative}\n{text[:12000] if text else ''}"
        domain = forced_domain or guess_domain(sample)
        machine, brand, model = infer_machine_metadata(sample)
        asset_id = None
        connection = self.connections[kind]
        media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        if text is None:
            asset_id = stable_id("ASSET", digest)
            before = connection.total_changes
            connection.execute(
                "INSERT OR IGNORE INTO assets(id,sha256,media_type,size_bytes,content) VALUES(?,?,?,?,?)",
                (asset_id, digest, media_type, len(data), data),
            )
            if connection.total_changes > before:
                self.stats[kind]["assets"] += 1
                self.stats[kind]["bytes"] += len(data)
        document_id = stable_id("DOC", collection, relative)
        connection.execute(
            """INSERT INTO documents(
              id,source_collection,source_path,title,scope,domain,machine_type,brand,model,
              media_type,sha256,size_bytes,verification_status,asset_id,imported_at
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                document_id, collection, relative, path.stem, scope, domain, machine, brand, model,
                media_type, digest, len(data), "原始资料/待工程验证", asset_id, now_iso(),
            ),
        )
        self.stats[kind]["documents"] += 1
        if text:
            chunks = split_text(text)
            for ordinal, (heading, content, refs) in enumerate(chunks, 1):
                chunk_domain = forced_domain or guess_domain(f"{heading}\n{content}")
                chunk_machine, chunk_brand, chunk_model = infer_machine_metadata(f"{heading}\n{content}")
                connection.execute(
                    """INSERT INTO chunks(
                    document_id,ordinal,heading,content,domain,machine_type,brand,model,image_refs
                    ) VALUES(?,?,?,?,?,?,?,?,?)""",
                    (
                        document_id, ordinal, heading, content, chunk_domain, chunk_machine,
                        chunk_brand, chunk_model, json.dumps(refs, ensure_ascii=False),
                    ),
                )
            self.stats[kind]["chunks"] += len(chunks)
        elif path.suffix.lower() in {".pdf", ".lad"}:
            # Binary engineering sources remain discoverable by metadata while their
            # complete bytes stay embedded as an asset.
            description = f"工程附件：{path.name}\n来源路径：{relative}\n分类：{domain}\n需使用原厂软件或 PDF 阅读器查看原文。"
            connection.execute(
                """INSERT INTO chunks(
                document_id,ordinal,heading,content,domain,machine_type,brand,model,image_refs
                ) VALUES(?,?,?,?,?,?,?,?,?)""",
                (document_id, 1, path.stem, description, domain, machine, brand, model, "[]"),
            )
            self.stats[kind]["chunks"] += 1

    def import_book(self, root: Path) -> None:
        if not root.is_dir():
            raise FileNotFoundError(f"书籍目录不存在：{root}")
        for path in sorted(root.rglob("*")):
            if path.is_file():
                self.add_file(path, root, "数控机床故障诊断与维修实例宝典", "common", "共通")

    def import_legacy(self, root: Path) -> None:
        if not root.is_dir():
            raise FileNotFoundError(f"v1 知识库不存在：{root}")
        for path in sorted(root.rglob("*")):
            if not path.is_file():
                continue
            relative = path.relative_to(root).as_posix()
            common = relative.startswith("00_知识库规范/") or relative.startswith("01_通用技术与控制平台/")
            domain = guess_domain(relative)
            if common:
                kind, scope = "common", "共通"
            elif domain == "电路" or path.suffix.lower() == ".lad":
                kind, scope = "circuit", "专有"
                domain = "电路"
            else:
                kind, scope = "equipment", "专有"
            self.add_file(path, root, "机床智能体知识库v1", kind, scope, domain)

    def import_circuit_sources(self, root: Path) -> None:
        """Import workspace engineering examples, keeping platform manuals common."""
        if not root.exists():
            return
        for path in sorted(root.rglob("*")):
            if not path.is_file() or "SAMA_logo" in path.parts:
                continue
            relative = path.relative_to(root).as_posix()
            value = normalize_text(relative)
            equipment_specific = any(word in value for word in (
                "favretto", "mikrosa", "米克罗莎", "studer", "米克罗莎", "电路图", ".lad",
            ))
            if equipment_specific:
                self.add_file(path, root, "工作区电路样本", "circuit", "专有", "电路")
            elif path.suffix.lower() == ".pdf" and any(word in value for word in ("fanuc", "0i-f", "法那科")):
                self.add_file(path, root, "工作区通用手册", "common", "共通")


def append_memory(paths: PackagePaths, event: str, payload: dict[str, Any]) -> None:
    paths.memory.parent.mkdir(parents=True, exist_ok=True)
    record = {"id": str(uuid.uuid4()), "timestamp": now_iso(), "event": event, "payload": payload}
    with paths.memory.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")


def database_stats(path: Path) -> dict[str, int]:
    with contextlib.closing(connect_db(path, readonly=True)) as connection:
        return {
            "documents": connection.execute("SELECT count(*) FROM documents").fetchone()[0],
            "chunks": connection.execute("SELECT count(*) FROM chunks").fetchone()[0],
            "assets": connection.execute("SELECT count(*) FROM assets").fetchone()[0],
            "asset_bytes": connection.execute("SELECT coalesce(sum(size_bytes),0) FROM assets").fetchone()[0],
        }


def validate_database_kind(kind: str) -> str:
    if kind not in DB_NAMES:
        raise ValueError(f"未知数据库：{kind}")
    return kind


def api_path(*parts: Any) -> str:
    return "/api/v1/" + "/".join(urllib.parse.quote(str(part), safe="") for part in parts)


def plain_text(value: str, limit: int | None = None) -> str:
    text = re.sub(r"<[^>]+>", " ", value)
    text = re.sub(r"!\[[^]]*\]\([^)]*\)", " ", text)
    text = re.sub(r"\[([^]]+)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"[*_`#>|]", " ", text)
    text = html.unescape(re.sub(r"\s+", " ", text)).strip()
    if limit and len(text) > limit:
        return text[: max(0, limit - 1)].rstrip() + "…"
    return text


def resolve_image_assets(
    connection: sqlite3.Connection,
    kind: str,
    source_collection: str,
    source_path: str,
    image_refs_json: str,
) -> list[dict[str, Any]]:
    try:
        refs = json.loads(image_refs_json or "[]")
    except json.JSONDecodeError:
        refs = []
    if not isinstance(refs, list):
        return []
    source_dir = Path(source_path).parent
    images: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw_ref in refs:
        ref = str(raw_ref).split("#", 1)[0].split("?", 1)[0]
        if not ref or urllib.parse.urlparse(ref).scheme:
            continue
        normalized = (source_dir / urllib.parse.unquote(ref)).as_posix()
        while normalized.startswith("./"):
            normalized = normalized[2:]
        row = connection.execute(
            """SELECT d.id document_id,d.asset_id,d.source_path,d.title,d.media_type,
            d.size_bytes,a.sha256 FROM documents d JOIN assets a ON a.id=d.asset_id
            WHERE d.source_collection=? AND d.source_path=? LIMIT 1""",
            (source_collection, normalized),
        ).fetchone()
        if not row or not row["asset_id"] or row["asset_id"] in seen:
            continue
        seen.add(row["asset_id"])
        images.append({
            "ref": str(raw_ref),
            "asset_id": row["asset_id"],
            "document_id": row["document_id"],
            "filename": Path(row["source_path"]).name,
            "media_type": row["media_type"],
            "size_bytes": row["size_bytes"],
            "sha256": row["sha256"],
            "url": api_path("assets", kind, row["asset_id"]),
        })
    return images


def rewrite_asset_references(content: str, images: list[dict[str, Any]]) -> str:
    rewritten = content
    for image_info in images:
        rewritten = rewritten.replace(image_info["ref"], image_info["url"])
    return rewritten


def serialize_chunk(
    connection: sqlite3.Connection,
    kind: str,
    row: sqlite3.Row,
    include_content: bool = True,
) -> dict[str, Any]:
    images = resolve_image_assets(
        connection, kind, row["source_collection"], row["source_path"], row["image_refs"],
    )
    raw_content = row["content"] if include_content else ""
    result = {
        "id": f"{kind}:{row['id']}",
        "chunk_id": row["id"],
        "database": kind,
        "document_id": row["document_id"],
        "ordinal": row["ordinal"],
        "heading": row["heading"],
        "domain": row["domain"],
        "machine_type": row["machine_type"],
        "brand": row["brand"],
        "model": row["model"],
        "verification_status": row["verification_status"],
        "source": {
            "collection": row["source_collection"],
            "path": row["source_path"],
            "title": row["title"],
        },
        "images": images,
        "urls": {
            "self": api_path("chunks", kind, row["id"]),
            "document": api_path("documents", kind, row["document_id"]),
        },
    }
    if include_content:
        display_text = plain_text(raw_content) or plain_text(row["heading"] or row["title"] or "")
        result.update({
            "content": rewrite_asset_references(raw_content, images),
            "content_raw": raw_content,
            "content_format": "markdown_with_html",
            "plain_text": display_text,
        })
    return result


def get_chunk(package: Path, kind: str, chunk_id: int) -> dict[str, Any] | None:
    kind = validate_database_kind(kind)
    paths = ensure_package(package)
    with contextlib.closing(connect_db(paths.db(kind), readonly=True)) as connection:
        row = connection.execute(
            """SELECT c.*,d.title,d.source_collection,d.source_path,d.verification_status
            FROM chunks c JOIN documents d ON d.id=c.document_id WHERE c.id=?""",
            (chunk_id,),
        ).fetchone()
        return serialize_chunk(connection, kind, row) if row else None


def get_document(
    package: Path,
    kind: str,
    document_id: str,
    chunk_page: int = 1,
    chunk_page_size: int = 20,
) -> dict[str, Any] | None:
    kind = validate_database_kind(kind)
    paths = ensure_package(package)
    with contextlib.closing(connect_db(paths.db(kind), readonly=True)) as connection:
        document = connection.execute("SELECT * FROM documents WHERE id=?", (document_id,)).fetchone()
        if not document:
            return None
        total_chunks = connection.execute(
            "SELECT count(*) FROM chunks WHERE document_id=?", (document_id,),
        ).fetchone()[0]
        chunk_offset = (chunk_page - 1) * chunk_page_size
        chunks = connection.execute(
            """SELECT c.*,d.title,d.source_collection,d.source_path,d.verification_status
            FROM chunks c JOIN documents d ON d.id=c.document_id
            WHERE c.document_id=? ORDER BY c.ordinal LIMIT ? OFFSET ?""",
            (document_id, chunk_page_size, chunk_offset),
        ).fetchall()
        result = dict(document)
        result["database"] = kind
        result["urls"] = {"self": api_path("documents", kind, document_id)}
        if document["asset_id"]:
            result["asset"] = {
                "asset_id": document["asset_id"],
                "url": api_path("assets", kind, document["asset_id"]),
                "download_url": api_path("assets", kind, document["asset_id"]) + "?download=1",
            }
        else:
            result["asset"] = None
        result["chunks"] = [serialize_chunk(connection, kind, row) for row in chunks]
        result["chunks_pagination"] = {
            "page": chunk_page,
            "page_size": chunk_page_size,
            "total": total_chunks,
            "has_more": chunk_offset + chunk_page_size < total_chunks,
            "next_page": chunk_page + 1 if chunk_offset + chunk_page_size < total_chunks else None,
        }
        return result


def list_documents(
    package: Path,
    kind: str | None = None,
    domain: str | None = None,
    machine_type: str | None = None,
    brand: str | None = None,
    model: str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> dict[str, Any]:
    paths = ensure_package(package)
    kinds = [validate_database_kind(kind)] if kind else list(DB_NAMES)
    filters: list[str] = []
    params: list[Any] = []
    for column, value in (("domain", domain), ("machine_type", machine_type), ("brand", brand), ("model", model)):
        if value:
            filters.append(f"coalesce({column},'') LIKE ?")
            params.append(f"%{value}%")
    where = " WHERE " + " AND ".join(filters) if filters else ""
    rows: list[dict[str, Any]] = []
    for db_kind in kinds:
        with contextlib.closing(connect_db(paths.db(db_kind), readonly=True)) as connection:
            for row in connection.execute(f"SELECT * FROM documents{where} ORDER BY title", params):
                item = dict(row)
                item["database"] = db_kind
                item["url"] = api_path("documents", db_kind, row["id"])
                if row["asset_id"]:
                    item["asset_url"] = api_path("assets", db_kind, row["asset_id"])
                rows.append(item)
    rows.sort(key=lambda item: (item["title"], item["database"], item["id"]))
    total = len(rows)
    start = (page - 1) * page_size
    return {"items": rows[start:start + page_size], "total": total, "page": page, "page_size": page_size, "has_more": start + page_size < total}


def available_filters(package: Path) -> dict[str, list[str]]:
    paths = ensure_package(package)
    values: dict[str, set[str]] = {"domains": set(), "machine_types": set(), "brands": set(), "models": set()}
    columns = (("domains", "domain"), ("machine_types", "machine_type"), ("brands", "brand"), ("models", "model"))
    for kind in DB_NAMES:
        with contextlib.closing(connect_db(paths.db(kind), readonly=True)) as connection:
            for output_key, column in columns:
                values[output_key].update(row[0] for row in connection.execute(f"SELECT DISTINCT {column} FROM chunks WHERE {column} IS NOT NULL AND {column}!=''"))
    return {key: sorted(items) for key, items in values.items()}


def get_asset(package: Path, kind: str, asset_id: str) -> dict[str, Any] | None:
    kind = validate_database_kind(kind)
    paths = ensure_package(package)
    with contextlib.closing(connect_db(paths.db(kind), readonly=True)) as connection:
        row = connection.execute(
            """SELECT a.*,d.source_path,d.title FROM assets a
            LEFT JOIN documents d ON d.asset_id=a.id WHERE a.id=? LIMIT 1""",
            (asset_id,),
        ).fetchone()
        return dict(row) if row else None


def write_manifest(paths: PackagePaths) -> dict[str, Any]:
    databases: dict[str, Any] = {}
    for kind, relative in DB_NAMES.items():
        db_path = paths.root / relative
        databases[kind] = {
            "path": relative,
            "sha256": sha256_file(db_path),
            "size_bytes": db_path.stat().st_size,
            "stats": database_stats(db_path),
        }
    manifest = {
        "format": "mtkb-portable-package",
        "format_version": 1,
        "app_version": APP_VERSION,
        "created_at": now_iso(),
        "databases": databases,
        "memory": {"path": ".memory/agent_memory.jsonl", "frontend_visible": False},
        "mount_command": "python3 mtkb.py --package <数据库包路径> serve",
    }
    paths.manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest


def build_package(package: Path, book: Path, legacy: Path, circuit_sources: Path | None = DEFAULT_CIRCUIT_SOURCES) -> dict[str, Any]:
    package = package.resolve()
    package.parent.mkdir(parents=True, exist_ok=True)
    temp_root = Path(tempfile.mkdtemp(prefix=f".{package.name}-build-", dir=package.parent))
    try:
        with Builder(temp_root) as builder:
            builder.import_book(book.resolve())
            builder.import_legacy(legacy.resolve())
            if circuit_sources:
                builder.import_circuit_sources(circuit_sources.resolve())
        paths = PackagePaths(temp_root)
        append_memory(paths, "knowledge_import", {
            "book": book.name, "legacy": legacy.name,
            "circuit_sources": circuit_sources.name if circuit_sources else None, "stats": builder.stats,
        })
        manifest = write_manifest(paths)
        backup = package.with_name(f".{package.name}-previous")
        if backup.exists():
            shutil.rmtree(backup)
        if package.exists():
            package.rename(backup)
        temp_root.rename(package)
        if backup.exists():
            shutil.rmtree(backup)
        return manifest
    except Exception:
        shutil.rmtree(temp_root, ignore_errors=True)
        raise


def ensure_package(package: Path) -> PackagePaths:
    paths = PackagePaths(package.resolve())
    if not paths.manifest.is_file():
        raise FileNotFoundError(f"不是有效数据库包（缺少 manifest.json）：{package}")
    for relative in DB_NAMES.values():
        if not (paths.root / relative).is_file():
            raise FileNotFoundError(f"数据库包缺少：{relative}")
    return paths


def query_terms(query: str) -> list[str]:
    normalized = normalize_text(query)
    parts = re.findall(r"[a-z0-9_.+/#-]+|[\u3400-\u9fff]{2,}", normalized)
    terms: list[str] = []
    for part in parts:
        if part not in terms:
            terms.append(part)
    for word in CIRCUIT_WORDS:
        if word in normalized and word not in terms:
            terms.append(word)
    return terms[:12]


def search_package(
    package: Path,
    query: str,
    domain: str | None = None,
    machine_type: str | None = None,
    brand: str | None = None,
    model: str | None = None,
    limit: int = 8,
    offset: int = 0,
) -> list[dict[str, Any]]:
    paths = ensure_package(package)
    terms = query_terms(query)
    if not terms:
        return []
    results: list[dict[str, Any]] = []
    for kind in DB_NAMES:
        with contextlib.closing(connect_db(paths.db(kind), readonly=True)) as connection:
            filters, params = [], []
            for column, value in (("c.domain", domain), ("c.machine_type", machine_type), ("c.brand", brand), ("c.model", model)):
                if value:
                    filters.append(f"coalesce({column},'') LIKE ?")
                    params.append(f"%{value}%")
            term_clause = " OR ".join("(c.content LIKE ? OR c.heading LIKE ? OR d.title LIKE ? OR d.source_path LIKE ?)" for _ in terms)
            term_params: list[str] = []
            for term in terms:
                term_params.extend([f"%{term}%"] * 4)
            where = f"({term_clause})"
            if filters:
                where += " AND " + " AND ".join(filters)
            rows = connection.execute(
                f"""SELECT c.id,c.heading,c.content,c.image_refs,d.id document_id,d.title,d.source_collection,
                d.source_path,d.scope,c.domain,c.machine_type,c.brand,c.model,d.verification_status
                FROM chunks c JOIN documents d ON d.id=c.document_id WHERE {where} LIMIT ?""",
                (*term_params, *params, max((offset + limit) * 5, 30)),
            ).fetchall()
            for row in rows:
                haystack = normalize_text(" ".join((row["heading"] or "", row["content"], row["title"])))
                score = sum((4 if term in normalize_text(row["heading"] or "") else 0) + min(3, haystack.count(term)) for term in terms)
                if domain and row["domain"] == domain:
                    score += 3
                if kind == "circuit":
                    score += 4
                if brand and row["brand"] and normalize_text(brand) in normalize_text(row["brand"]):
                    score += 3
                if machine_type and row["machine_type"] and normalize_text(machine_type) in normalize_text(row["machine_type"]):
                    score += 2
                item = dict(row)
                item.update({"database": kind, "score": score, "excerpt": row["content"][:700]})
                item.pop("content")
                results.append(item)
    results.sort(key=lambda item: (-item["score"], item["source_path"], item["id"]))
    safe_limit = max(1, min(limit, 51))
    return results[max(0, offset):max(0, offset) + safe_limit]


def search_for_frontend(
    package: Path,
    query: str,
    domain: str | None = None,
    machine_type: str | None = None,
    brand: str | None = None,
    model: str | None = None,
    page: int = 1,
    page_size: int = 10,
) -> dict[str, Any]:
    offset = (page - 1) * page_size
    raw_items = search_package(
        package, query, domain, machine_type, brand, model, page_size + 1, offset,
    )
    has_more = len(raw_items) > page_size
    items: list[dict[str, Any]] = []
    for raw in raw_items[:page_size]:
        detail = get_chunk(package, raw["database"], int(raw["id"]))
        if not detail:
            continue
        detail["score"] = raw["score"]
        detail["excerpt"] = plain_text(detail["content_raw"], 320)
        items.append(detail)
    return {
        "query": query,
        "items": items,
        "page": page,
        "page_size": page_size,
        "has_more": has_more,
        "next_page": page + 1 if has_more else None,
        "applied_filters": {
            "domain": domain, "machine_type": machine_type, "brand": brand, "model": model,
        },
    }


REQUIRED_FIELDS = {
    "加装伺服电机": (
        ("supply_voltage_v", "主电源电压/相数/频率"),
        ("motor_power_kw", "伺服电机额定功率与额定/峰值转矩"),
        ("control_voltage_v", "控制电压"),
        ("drive_model", "伺服驱动器完整型号与厂家手册"),
        ("load_inertia_kgm2", "负载折算惯量、最高转速和减速时间"),
        ("safety_category", "目标安全等级及现有急停/STO架构"),
        ("existing_drawing", "现有整机电气图、端子表和 I/O 表"),
    ),
    "添加制动电阻": (
        ("drive_model", "驱动器完整型号及允许最小制动电阻"),
        ("dc_bus_voltage_v", "制动动作时直流母线电压"),
        ("load_inertia_kgm2", "负载折算惯量"),
        ("max_speed_rpm", "最高转速"),
        ("decel_time_s", "减速时间与工作周期"),
    ),
    "添加电阻电容": (
        ("circuit_function", "目标：滤波、吸收浪涌、去抖或放电"),
        ("node_voltage_v", "节点正常/最大电压及 AC/DC"),
        ("load_current_a", "负载电流和开关频率"),
        ("waveform", "示波器波形或浪涌幅值/持续时间"),
        ("component_datasheet", "负载和开关器件数据手册"),
    ),
}


def change_family(change: str) -> str:
    value = normalize_text(change)
    if "伺服" in value and ("加" in value or "改" in value):
        return "加装伺服电机"
    if "制动电阻" in value:
        return "添加制动电阻"
    if "电阻" in value or "电容" in value or "rc" in value:
        return "添加电阻电容"
    return "通用电路修改"


def circuit_plan(package: Path, request: dict[str, Any]) -> dict[str, Any]:
    machine_type = str(request.get("machine_type") or "").strip()
    change = str(request.get("change") or "").strip()
    if not machine_type or not change:
        raise ValueError("machine_type 和 change 为必填字段")
    family = change_family(change)
    required = REQUIRED_FIELDS.get(family, (
        ("existing_drawing", "现有整机电气图、端子表和 I/O 表"),
        ("supply_voltage_v", "电源制式"),
        ("target_spec", "改造目标和负载规格"),
        ("safety_category", "安全等级与急停架构"),
    ))
    missing = [{"field": field, "description": description} for field, description in required if request.get(field) in (None, "", [])]
    brand, model = request.get("brand"), request.get("model")
    search_query = f"{change} 伺服电机 接线 连接 制动电阻 电气图 驱动器 梯形图 急停 STO"
    evidence = search_package(package, search_query, domain="电路", brand=str(brand) if brand else None, limit=8)
    if len(evidence) < 3:
        evidence = search_package(package, f"{search_query} {machine_type} {model or ''}", domain="电路", limit=8)

    if family == "加装伺服电机":
        topology = [
            "主回路：上级隔离/断路保护 →（按驱动器手册配置接触器、滤波器或电抗器）→ 伺服驱动器 → U/V/W → 伺服电机；PE 单独可靠连接，禁止把 PE 当工作零线。",
            "反馈回路：编码器使用厂家规定电缆直达驱动器，动力线与反馈/模拟量分槽，屏蔽层按厂家 EMC 方案端接。",
            "控制回路：24 VDC 控制电源 → 双通道安全回路/安全继电器 → 驱动器 STO；普通 Servo-ON、Ready、Alarm、Reset、限位与 PLC I/O 分开表达。",
            "制动回路：仅在驱动器支持时接厂家规定的内置/外置制动单元与电阻；温控触点纳入停机链，电阻安装满足散热和防触碰要求。",
        ]
    elif family == "添加制动电阻":
        topology = [
            "先确认驱动器是否内置制动晶体管及专用端子；不得凭相似型号接线。",
            "由负载惯量、速度变化、减速时间和周期计算再生能量，再与驱动器允许最小阻值、峰值/连续制动功率共同校核。",
            "电阻支路配置过温检测并纳入受控停机；安装位置满足散热、阻燃、防触碰和线缆耐温要求。",
        ]
    elif family == "添加电阻电容":
        topology = [
            "先用波形和器件手册确认问题属于浪涌、触点拉弧、信号去抖、滤波还是母线放电，不能用同一 RC 经验值替代测量。",
            "线圈/接触器抑制器优先采用厂家匹配模块；DC 线圈需校核续流器件对释放时间和安全停机的影响。",
            "RC/电容的耐压、脉冲能力、阻燃等级、漏电流、放电时间和失效模式必须逐项校核；跨市电元件使用相应安规等级。",
        ]
    else:
        topology = [
            "在原图副本上标注新增支路、线号、端子号、保护器件、I/O 和变更版本。",
            "功率、控制、安全和反馈回路分层设计；任何安全功能不得只依赖普通 PLC 软件。",
            "所有端子和定值以具体设备/器件厂家手册为准。",
        ]

    calculations: list[dict[str, Any]] = []
    if family in ("加装伺服电机", "添加制动电阻"):
        try:
            inertia = float(request["load_inertia_kgm2"])
            speed = float(request["max_speed_rpm"])
            decel = float(request["decel_time_s"])
            omega = speed * 2 * 3.141592653589793 / 60
            energy = 0.5 * inertia * omega * omega
            calculations.append({
                "name": "单次减速负载动能（未含效率和电机转子惯量）",
                "formula": "E = 0.5 × J × ω²",
                "value_j": round(energy, 2),
                "minimum_average_during_decel_w": round(energy / decel, 2),
                "note": "只用于初筛；最终电阻值/功率必须结合驱动器制动阈值、占空比、内置电阻和厂家曲线。",
            })
        except (KeyError, TypeError, ValueError, ZeroDivisionError):
            pass

    query_id = f"Q-{uuid.uuid4().hex[:12]}"
    plan = {
        "query_id": query_id,
        "status": "信息不足，仅可输出架构草案" if missing else "待工程审核的完整输入草案",
        "request_summary": {"machine_type": machine_type, "brand": brand, "model": model, "change": change, "family": family},
        "missing_inputs": missing,
        "proposed_topology": topology,
        "calculations": calculations,
        "prohibited_assumptions": [
            "不猜测驱动器端子号、导线截面、保护器件额定值、制动电阻阻值或电容容量。",
            "不旁路急停、安全门、超程、STO、过载、过温或接地保护。",
            "不把相近品牌/机型案例直接当作当前设备的现场接线事实。",
        ],
        "verification_steps": [
            "收齐当前版本整机电气图、驱动器/电机手册、端子表、PLC/PMC I/O 表和参数备份。",
            "由具备资质的电气工程师完成负载、短路电流、选择性保护、温升、EMC 和安全回路校核。",
            "形成带版本号的红线图/BOM/线号表/风险评估，并由第二人复核。",
            "执行锁定挂牌、断电验电和点对点校线；先断开机械负载做低风险上电测试。",
            "依次验证急停、STO、限位、报警、断线、过温和掉电等故障工况，再进行受控负载试运行。",
        ],
        "evidence": [
            {
                "database": item["database"], "document_id": item["document_id"], "title": item["title"],
                "chunk_id": item["id"],
                "heading": item["heading"], "source": f"{item['source_collection']}/{item['source_path']}",
                "verification_status": item["verification_status"], "excerpt": item["excerpt"],
                "urls": {
                    "chunk": api_path("chunks", item["database"], item["id"]),
                    "document": api_path("documents", item["database"], item["document_id"]),
                },
            }
            for item in evidence
        ],
        "disclaimer": "本结果是设计输入与证据草案，不是施工授权或最终电气图。",
    }
    append_memory(ensure_package(package), "circuit_plan", {
        "query_id": query_id, "request": request, "family": family,
        "missing_fields": [item["field"] for item in missing],
        "evidence_ids": [item["document_id"] for item in evidence],
    })
    return plan


def export_package(package: Path, output: Path) -> dict[str, Any]:
    paths = ensure_package(package)
    manifest = write_manifest(paths)
    output = output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    temp = output.with_name(f".{output.name}.{uuid.uuid4().hex}.tmp")
    with zipfile.ZipFile(temp, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
        for path in sorted(paths.root.rglob("*")):
            if path.is_file():
                archive.write(path, Path(paths.root.name) / path.relative_to(paths.root))
    os.replace(temp, output)
    return {"output": str(output), "sha256": sha256_file(output), "size_bytes": output.stat().st_size, "manifest": manifest}


def install_archive(archive_path: Path, destination: Path) -> dict[str, Any]:
    """Safely and atomically install a shared package archive."""
    archive_path = archive_path.resolve()
    destination = destination.resolve()
    check = verify_package_or_archive(archive_path)
    if not check["ok"]:
        raise ValueError("分享包校验失败，拒绝接入")
    destination.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".{destination.name}-install-", dir=destination.parent))
    backup = destination.with_name(f".{destination.name}-previous")
    try:
        with zipfile.ZipFile(archive_path, "r") as archive:
            archive.extractall(staging)
        roots = [path.parent for path in staging.rglob("manifest.json")]
        if len(roots) != 1:
            raise ValueError("分享包结构错误")
        source = roots[0]
        if backup.exists():
            shutil.rmtree(backup)
        if destination.exists():
            destination.rename(backup)
        source.rename(destination)
        shutil.rmtree(staging, ignore_errors=True)
        if backup.exists():
            shutil.rmtree(backup)
        return {"ok": True, "installed_to": str(destination), "next": f"python3 mtkb.py --package '{destination}' serve"}
    except Exception:
        if backup.exists() and not destination.exists():
            backup.rename(destination)
        shutil.rmtree(staging, ignore_errors=True)
        raise


def verify_package_or_archive(target: Path) -> dict[str, Any]:
    target = target.resolve()
    extracted: Path | None = None
    try:
        if target.is_file():
            extracted = Path(tempfile.mkdtemp(prefix="mtkb-verify-"))
            with zipfile.ZipFile(target, "r") as archive:
                for member in archive.infolist():
                    resolved = (extracted / member.filename).resolve()
                    if extracted.resolve() not in resolved.parents and resolved != extracted.resolve():
                        raise ValueError(f"压缩包包含不安全路径：{member.filename}")
                archive.extractall(extracted)
            roots = [path.parent for path in extracted.rglob("manifest.json")]
            if len(roots) != 1:
                raise ValueError("压缩包必须且只能包含一个 manifest.json")
            package = roots[0]
        else:
            package = target
        paths = ensure_package(package)
        manifest = json.loads(paths.manifest.read_text(encoding="utf-8"))
        checks = []
        for kind, info in manifest["databases"].items():
            db_path = paths.root / info["path"]
            actual = sha256_file(db_path)
            with contextlib.closing(connect_db(db_path, readonly=True)) as connection:
                integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
            checks.append({"database": kind, "checksum_ok": actual == info["sha256"], "integrity": integrity})
        ok = all(item["checksum_ok"] and item["integrity"] == "ok" for item in checks)
        return {"ok": ok, "checks": checks}
    finally:
        if extracted:
            shutil.rmtree(extracted, ignore_errors=True)


class ApiHandler(http.server.BaseHTTPRequestHandler):
    package: Path
    server_version = f"MTKB/{APP_VERSION}"

    def common_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Request-ID")
        self.send_header("Access-Control-Expose-Headers", "Content-Length, Content-Range, ETag, X-Request-ID")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Request-ID", getattr(self, "request_id", ""))

    def send_json(self, status: int, payload: Any, cache_control: str = "no-store") -> None:
        data = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", cache_control)
        self.common_headers()
        self.end_headers()
        self.wfile.write(data)

    def send_data(self, data: Any, status: int = 200, meta: dict[str, Any] | None = None) -> None:
        self.send_json(status, {"data": data, "meta": meta or {}, "error": None})

    def send_error_json(self, status: int, code: str, message: str, details: Any = None) -> None:
        self.send_json(status, {
            "data": None,
            "meta": {},
            "error": {"code": code, "message": message, "details": details},
        })

    def parse_json_body(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("Content-Length 无效") from exc
        if length <= 0 or length > 2 * 1024 * 1024:
            raise ValueError("请求体为空或超过 2 MB")
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("请求体必须是有效的 UTF-8 JSON") from exc
        if not isinstance(payload, dict):
            raise ValueError("JSON 顶层必须是对象")
        return payload

    @staticmethod
    def positive_int(value: Any, default: int, maximum: int) -> int:
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return default
        return min(max(parsed, 1), maximum)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.request_id = self.headers.get("X-Request-ID") or uuid.uuid4().hex
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.common_headers()
        self.end_headers()

    def send_asset(self, kind: str, asset_id: str, download: bool = False, head_only: bool = False) -> None:
        asset = get_asset(self.package, kind, asset_id)
        if not asset:
            self.send_error_json(404, "ASSET_NOT_FOUND", "附件不存在")
            return
        content: bytes = asset["content"]
        size = len(content)
        start, end, status = 0, max(0, size - 1), 200
        range_header = self.headers.get("Range")
        if range_header:
            match = re.fullmatch(r"bytes=(\d*)-(\d*)", range_header.strip())
            if not match:
                self.send_error_json(416, "INVALID_RANGE", "Range 请求格式无效")
                return
            if match.group(1):
                start = int(match.group(1))
                end = int(match.group(2)) if match.group(2) else end
            elif match.group(2):
                suffix = int(match.group(2))
                start = max(0, size - suffix)
            if start >= size or start > end:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.common_headers()
                self.end_headers()
                return
            end = min(end, size - 1)
            status = 206
        body = content[start:end + 1]
        filename = Path(asset.get("source_path") or asset.get("title") or asset_id).name
        disposition = "attachment" if download else "inline"
        encoded_name = urllib.parse.quote(filename)
        self.send_response(status)
        self.send_header("Content-Type", asset["media_type"])
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("ETag", f'"{asset["sha256"]}"')
        self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        self.send_header("Content-Disposition", f"{disposition}; filename*=UTF-8''{encoded_name}")
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.common_headers()
        self.end_headers()
        if not head_only:
            self.wfile.write(body)

    def api_description(self) -> dict[str, Any]:
        return {
            "name": "机床智能体本地知识库 API",
            "version": APP_VERSION,
            "api_version": API_VERSION,
            "base_url": "/api/v1",
            "content_format": "markdown_with_html",
            "endpoints": {
                "health": "GET /api/v1/health",
                "filters": "GET /api/v1/filters",
                "documents": "GET /api/v1/documents?page=1&page_size=20",
                "document": "GET /api/v1/documents/{database}/{document_id}",
                "chunk": "GET /api/v1/chunks/{database}/{chunk_id}",
                "asset": "GET /api/v1/assets/{database}/{asset_id}",
                "search": "POST /api/v1/search",
                "circuit_plan": "POST /api/v1/circuit-plans",
                "feedback": "POST /api/v1/feedback",
            },
            "compatibility_endpoints": ["GET /health", "POST /search", "POST /circuit/plan"],
        }

    def do_GET(self) -> None:  # noqa: N802
        self.request_id = self.headers.get("X-Request-ID") or uuid.uuid4().hex
        try:
            parsed = urllib.parse.urlsplit(self.path)
            path = parsed.path.rstrip("/") or "/"
            query = urllib.parse.parse_qs(parsed.query)
            parts = [urllib.parse.unquote(part) for part in path.split("/") if part]
            if path == "/":
                self.send_data(self.api_description())
            elif path in ("/health", "/api/v1/health"):
                paths = ensure_package(self.package)
                payload = {"status": "ok", "version": APP_VERSION, "api_version": API_VERSION, "databases": {kind: database_stats(paths.db(kind)) for kind in DB_NAMES}}
                if path == "/health":
                    self.send_json(200, payload)
                else:
                    self.send_data(payload)
            elif path == "/api/v1":
                self.send_data(self.api_description())
            elif path == "/api/v1/filters":
                self.send_data(available_filters(self.package))
            elif path == "/api/v1/documents":
                page = self.positive_int(query.get("page", [1])[0], 1, 1_000_000)
                page_size = self.positive_int(query.get("page_size", [20])[0], 20, 100)
                result = list_documents(
                    self.package,
                    query.get("database", [None])[0], query.get("domain", [None])[0],
                    query.get("machine_type", [None])[0], query.get("brand", [None])[0],
                    query.get("model", [None])[0], page, page_size,
                )
                items = result.pop("items")
                self.send_data(items, meta=result)
            elif len(parts) == 5 and parts[:3] == ["api", "v1", "documents"]:
                chunk_page = self.positive_int(query.get("chunk_page", [1])[0], 1, 1_000_000)
                chunk_page_size = self.positive_int(query.get("chunk_page_size", [20])[0], 20, 100)
                document = get_document(self.package, parts[3], parts[4], chunk_page, chunk_page_size)
                if document:
                    self.send_data(document)
                else:
                    self.send_error_json(404, "DOCUMENT_NOT_FOUND", "文档不存在")
            elif len(parts) == 5 and parts[:3] == ["api", "v1", "chunks"]:
                try:
                    chunk_id = int(parts[4])
                except ValueError:
                    raise ValueError("chunk_id 必须是整数")
                chunk = get_chunk(self.package, parts[3], chunk_id)
                if chunk:
                    self.send_data(chunk)
                else:
                    self.send_error_json(404, "CHUNK_NOT_FOUND", "正文块不存在")
            elif len(parts) == 5 and parts[:3] == ["api", "v1", "assets"]:
                self.send_asset(parts[3], parts[4], query.get("download", ["0"])[0] == "1")
            else:
                self.send_error_json(404, "ROUTE_NOT_FOUND", "接口路径不存在")
        except ValueError as exc:
            self.send_error_json(400, "INVALID_REQUEST", str(exc))
        except FileNotFoundError as exc:
            self.send_error_json(503, "PACKAGE_UNAVAILABLE", str(exc))
        except Exception as exc:
            self.send_error_json(500, "INTERNAL_ERROR", "服务器内部错误", str(exc))

    def do_HEAD(self) -> None:  # noqa: N802
        self.request_id = self.headers.get("X-Request-ID") or uuid.uuid4().hex
        parsed = urllib.parse.urlsplit(self.path)
        parts = [urllib.parse.unquote(part) for part in parsed.path.split("/") if part]
        if len(parts) == 5 and parts[:3] == ["api", "v1", "assets"]:
            self.send_asset(parts[3], parts[4], urllib.parse.parse_qs(parsed.query).get("download", ["0"])[0] == "1", True)
        else:
            self.send_error_json(404, "ROUTE_NOT_FOUND", "接口路径不存在")

    def do_POST(self) -> None:  # noqa: N802
        self.request_id = self.headers.get("X-Request-ID") or uuid.uuid4().hex
        try:
            payload = self.parse_json_body()
            path = urllib.parse.urlsplit(self.path).path.rstrip("/")
            if path in ("/search", "/api/v1/search"):
                search_query = str(payload.get("query") or "").strip()
                if not search_query:
                    raise ValueError("query 为必填字段")
                if path == "/search":
                    result = search_package(
                        self.package, search_query, payload.get("domain"), payload.get("machine_type"),
                        payload.get("brand"), payload.get("model"), self.positive_int(payload.get("limit"), 8, 50),
                    )
                    self.send_json(200, {"results": result})
                    return
                page = self.positive_int(payload.get("page"), 1, 1_000_000)
                page_size = self.positive_int(payload.get("page_size"), 10, 50)
                result = search_for_frontend(
                    self.package, search_query, payload.get("domain"), payload.get("machine_type"),
                    payload.get("brand"), payload.get("model"), page, page_size,
                )
                items = result.pop("items")
                self.send_data(items, meta=result)
            elif path in ("/circuit/plan", "/api/v1/circuit-plans"):
                result = circuit_plan(self.package, payload)
                if path == "/circuit/plan":
                    self.send_json(200, result)
                else:
                    self.send_data(result, 201)
            elif path == "/api/v1/feedback":
                query_id = str(payload.get("query_id") or "").strip()
                result = str(payload.get("result") or "").strip()
                note = str(payload.get("note") or "").strip()
                allowed = {"accepted", "rejected", "revised", "field_verified"}
                if not query_id or result not in allowed or not note:
                    raise ValueError("query_id、有效的 result 和 note 为必填字段")
                append_memory(ensure_package(self.package), "human_feedback", {"query_id": query_id, "result": result, "note": note})
                self.send_data({"saved": True, "query_id": query_id}, 201)
            else:
                self.send_error_json(404, "ROUTE_NOT_FOUND", "接口路径不存在")
        except ValueError as exc:
            self.send_error_json(400, "INVALID_REQUEST", str(exc))
        except FileNotFoundError as exc:
            self.send_error_json(503, "PACKAGE_UNAVAILABLE", str(exc))
        except Exception as exc:
            self.send_error_json(500, "INTERNAL_ERROR", "服务器内部错误", str(exc))

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write(f"[{self.log_date_time_string()}] {fmt % args}\n")


def serve(package: Path, port: int) -> None:
    ensure_package(package)
    handler = type("BoundApiHandler", (ApiHandler,), {"package": package.resolve()})
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    print(f"MTKB 已挂载：http://127.0.0.1:{port}（Ctrl+C 停止）")
    server.serve_forever()


def print_json(payload: Any) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description="机床智能体可携带本地知识库")
    result.add_argument("--package", type=Path, default=DEFAULT_PACKAGE, help="数据库包目录")
    commands = result.add_subparsers(dest="command", required=True)
    build = commands.add_parser("build", help="从两套资料原子构建数据库包")
    build.add_argument("--book", type=Path, default=DEFAULT_BOOK)
    build.add_argument("--legacy", type=Path, default=DEFAULT_LEGACY)
    build.add_argument("--circuit-sources", type=Path, default=DEFAULT_CIRCUIT_SOURCES)
    commands.add_parser("status", help="显示数据库统计")
    search = commands.add_parser("search", help="检索全部分层数据库")
    search.add_argument("query")
    search.add_argument("--domain")
    search.add_argument("--machine-type")
    search.add_argument("--brand")
    search.add_argument("--model")
    search.add_argument("--limit", type=int, default=8)
    plan = commands.add_parser("circuit-plan", help="生成电路改造工程草案")
    plan.add_argument("--request-json", type=Path)
    plan.add_argument("--machine-type")
    plan.add_argument("--brand")
    plan.add_argument("--model")
    plan.add_argument("--change")
    plan.add_argument("--supply-voltage-v", type=float)
    plan.add_argument("--motor-power-kw", type=float)
    plan.add_argument("--control-voltage-v", type=float)
    plan.add_argument("--drive-model")
    plan.add_argument("--load-inertia-kgm2", type=float)
    plan.add_argument("--max-speed-rpm", type=float)
    plan.add_argument("--decel-time-s", type=float)
    feedback = commands.add_parser("feedback", help="写入隐藏 Agent 反馈日志")
    feedback.add_argument("--query-id", required=True)
    feedback.add_argument("--result", required=True, choices=("accepted", "rejected", "revised", "field_verified"))
    feedback.add_argument("--note", required=True)
    export = commands.add_parser("export", help="导出一键分享包")
    export.add_argument("--output", type=Path, required=True)
    install = commands.add_parser("install", help="校验并一键接入分享包")
    install.add_argument("--archive", type=Path, required=True)
    install.add_argument("--destination", type=Path, required=True)
    verify = commands.add_parser("verify", help="校验数据库目录或分享包")
    verify.add_argument("target", type=Path)
    server = commands.add_parser("serve", help="启动仅本机可访问的 HTTP 接口")
    server.add_argument("--port", type=int, default=8765)
    return result


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        if args.command == "build":
            print_json(build_package(args.package, args.book, args.legacy, args.circuit_sources))
        elif args.command == "status":
            paths = ensure_package(args.package)
            print_json({kind: database_stats(paths.db(kind)) for kind in DB_NAMES})
        elif args.command == "search":
            print_json(search_package(args.package, args.query, args.domain, args.machine_type, args.brand, args.model, args.limit))
        elif args.command == "circuit-plan":
            if args.request_json:
                request = json.loads(args.request_json.read_text(encoding="utf-8"))
            else:
                request = {
                    key: value for key, value in {
                        "machine_type": args.machine_type, "brand": args.brand, "model": args.model,
                        "change": args.change, "supply_voltage_v": args.supply_voltage_v,
                        "motor_power_kw": args.motor_power_kw, "control_voltage_v": args.control_voltage_v,
                        "drive_model": args.drive_model, "load_inertia_kgm2": args.load_inertia_kgm2,
                        "max_speed_rpm": args.max_speed_rpm, "decel_time_s": args.decel_time_s,
                    }.items() if value is not None
                }
            print_json(circuit_plan(args.package, request))
        elif args.command == "feedback":
            paths = ensure_package(args.package)
            append_memory(paths, "human_feedback", {"query_id": args.query_id, "result": args.result, "note": args.note})
            print_json({"ok": True})
        elif args.command == "export":
            print_json(export_package(args.package, args.output))
        elif args.command == "install":
            print_json(install_archive(args.archive, args.destination))
        elif args.command == "verify":
            result = verify_package_or_archive(args.target)
            print_json(result)
            return 0 if result["ok"] else 2
        elif args.command == "serve":
            serve(args.package, args.port)
        return 0
    except KeyboardInterrupt:
        return 130
    except Exception as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

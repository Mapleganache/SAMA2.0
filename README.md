# SAMA 2.0 磨床诊断 Agent

当前主体沿用团队的LangChain/LangGraph流程。SQLite直接接入既有`search_knowledge`、`search_mtkb`，Main、Sub、Judge与门控流程保持原样。

## 拉取后测试

需要Git、Node.js **22.13或更高版本**及npm，建议预留至少3GB磁盘空间。

```sh
git clone https://gitee.com/maplegannache/sama2.0.git
cd sama2.0/sama2.0
npm ci
npm test
npm start
```

已有仓库先在仓库根目录执行`git pull --ff-only`，再进入内部`sama2.0`目录执行后续命令。根目录不再是旧Electron应用，不要在根目录运行`npm ci`。

`npm ci`自动从随Git提供的压缩分片还原SQLite，逐片及整库校验SHA-256，不需要复制他人电脑上的绝对路径、不需要Python，也不需要额外启动8765端口服务。

`npm test`是无真实API调用的安装、检索、引用、门控和LangGraph接线测试，不需要API密钥；通过不代表维修答案准确率达标。

`npm start`启动浏览器页面：<http://127.0.0.1:3920>。真正生成模型回答时，需要在页面填写自己的API密钥，或在内部`sama2.0`目录创建被Git忽略的`settings.json`。参考[配置示例](sama2.0/settings.example.json)，不要提交密钥。

## 随仓库的数据

- [分发清单](sama2.0/database-pack/manifest.json)：16个压缩分片，合计约249MiB；还原后约1.31GiB。
- 198,953个原文片段，默认参考层66,593条；其余按类型、机型和待核验原因隔离。
- 63,076条旧库数据记录，479条案例关系，20条此前核对的试点内容。
- 配置使用`data/sama_full.sqlite`相对路径；展开的大库被Git忽略，原始压缩分片随Git同步。

分发包包含完整文本、关系、来源元数据和搜索索引。**原PDF、LAD及图像文件未随包分发**，图像/BLOB元数据保留原来源和指纹；文本检索及Agent流程测试不依赖这些外部文件。审核原图、曲线或电路时仍需取得对应原始资料，不能把包内来源路径当作队友电脑上已存在的文件。

当前默认`reference`模式，所有新导入内容的专业审核仍待完成，正式批准为0。历史数值和历史处理不能直接当作本机阈值或维修指令。

更详细的接口、数据和测试说明见[数据库接入说明](sama2.0/DATABASE.md)。

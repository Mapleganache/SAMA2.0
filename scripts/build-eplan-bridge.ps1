# 编译 Sama.Eplan29Bridge.exe 并复制到 electron/resources/eplan-bridge/
$ErrorActionPreference = 'Stop'
$root = Join-Path $PSScriptRoot '..'
$proj = Join-Path $root 'tools\eplan-bridge\Sama.Eplan29Bridge\Sama.Eplan29Bridge.csproj'
$outDir = Join-Path $root 'electron\resources\eplan-bridge'
$publish = Join-Path $env:TEMP 'sama-eplan-bridge-publish'

if (-not (Test-Path $proj)) { throw "Project not found: $proj" }

dotnet publish $proj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o $publish
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed" }

New-Item -ItemType Directory -Force -Path $outDir | Out-Null
Copy-Item -Force (Join-Path $publish 'Sama.Eplan29Bridge.exe') (Join-Path $outDir 'Sama.Eplan29Bridge.exe')
# 保留完整发布目录供 dotnet 宿主异常时回退
$pubDest = Join-Path $outDir 'publish'
if (Test-Path $pubDest) { Remove-Item -Recurse -Force $pubDest }
Copy-Item -Recurse -Force $publish $pubDest
Write-Host "OK -> $outDir\Sama.Eplan29Bridge.exe (+ publish\)"

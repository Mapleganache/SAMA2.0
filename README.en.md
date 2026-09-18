# SAMA 2.0

Windows workstation for machine-tool maintenance, electrical drafting, and G-code assistance.

Download the Windows installer from **Releases**. The setup file is split into `SAMA-1.3.0-windows-x64-setup.7z.00x` parts (Gitee 100 MB attachment limit). Download every part, extract `.7z.001` with 7-Zip or Bandizip, then run `SAMA-1.3.0-Setup.exe`.

Requires Windows 10/11 x64. The build is not code-signed.

```bat
npm install
npm run build
npx electron .
```

```bat
npm run dist:win
```

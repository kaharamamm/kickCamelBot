@echo off
cd /d "%~dp0.."
if not exist data mkdir data
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js not found. Install it, then start CamelBot again.>> data\camelbot.log
  exit /b 1
)
echo ----- %date% %time% starting CamelBot ----->> data\camelbot.log
node node_modules\tsx\dist\cli.mjs src\index.ts >> data\camelbot.log 2>&1

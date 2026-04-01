@echo off
REM ═══════════════════════════════════════════════════════════════
REM FirmClaw 离线部署打包脚本
REM ═══════════════════════════════════════════════════════════════
REM 
REM 使用方法：
REM   1. 在有网络的机器上运行此脚本
REM   2. 会生成 offline-bundle.zip
REM   3. 拷贝到目标机器解压后即可运行（需先配置 .env）
REM ═══════════════════════════════════════════════════════════════

echo [1/4] Building project...
call npm run build
if errorlevel 1 goto error

echo [2/4] Installing production dependencies...
call npm install --omit=dev
if errorlevel 1 goto error

echo [3/4] Creating bundle...
if exist offline-bundle.zip del offline-bundle.zip

REM 打包必要文件
powershell -Command "Compress-Archive -Path 'dist','node_modules','package.json','package-lock.json','.env.example','README.md' -DestinationPath 'offline-bundle.zip' -Force"

echo [4/4] Done!
echo.
echo 离线部署包已生成: offline-bundle.zip
echo.
echo 使用方法：
echo   1. 解压 offline-bundle.zip 到目标机器
echo   2. 复制 .env.example 为 .env
echo   3. 编辑 .env 填入你的 LLM API 配置
echo   4. 运行: node dist/index.js
echo.
goto end

:error
echo Build failed!
exit /b 1

:end
pause
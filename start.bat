@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo === Fluency Coach Bot ===
echo Папка: %CD%
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ОШИБКА] Node.js не установлен.
  echo Скачай с https://nodejs.org и установи LTS версию.
  pause
  exit /b 1
)

echo Node: 
node -v
echo.

if not exist "node_modules\" (
  echo Устанавливаю зависимости...
  call npm install
  if errorlevel 1 (
    echo [ОШИБКА] npm install не удался.
    pause
    exit /b 1
  )
)

if not exist ".env" (
  echo [ОШИБКА] Нет файла .env
  echo Скопируй: copy .env.example .env
  echo И впиши BOT_TOKEN от BotFather.
  pause
  exit /b 1
)

where ffmpeg >nul 2>&1
if errorlevel 1 (
  echo [ПРЕДУПРЕЖДЕНИЕ] ffmpeg не установлен — голос распознаётся, но качество может быть ниже.
  echo Скачай: https://www.gyan.dev/ffmpeg/builds/ ^(ffmpeg-release-essentials.zip^)
)

echo Запускаю бота...
echo Остановка: Ctrl+C
echo.
node --disable-warning=ExperimentalWarning src/index.js

if errorlevel 1 (
  echo.
  echo [ОШИБКА] Бот завершился с ошибкой.
  pause
)

# Hypervibe - Setup CLIs (Windows)
# Generates a bat file and launches it in an interactive CMD window.
# Sequential: install + login per CLI, skips already installed/connected.
# Tracks per-CLI status and displays a dynamic rapport at the end so that
# if the user cancels a login or the install fails, the script tells them
# exactly what's still missing instead of falsely claiming success.
#
# CMD rules:
# - "call" before every .cmd wrapper (npm, vercel)
# - NEVER combine "call" with && or || on the same line (CMD parses it wrong)
# - Use "if not errorlevel 1 goto" on a SEPARATE line for conditionals
# - gh is an .exe (not .cmd) so it doesn't need "call"
#
# Neon is handled via REST API + vault key (NEON.api_key) + run-sql helper, not via CLI or MCP.
# Wrangler (Cloudflare) is installed here, but auth = via CLOUDFLARE_API_TOKEN
# env var that /start sets BEFORE launching this script. No `wrangler login`.
#
# Why `npm install -g` and not `pnpm add -g` (despite the pnpm-only rule) :
# this script tourne pendant /start, AVANT que `pnpm setup` ait potentiellement
# été exécuté. À ce moment-là, `pnpm` peut ne pas être sur le PATH ou installer
# dans un dossier hors PATH. `npm` est livré avec Node, donc toujours dispo.
# Une fois /start terminé, les autres skills utilisent bien `pnpm add -g`.

$bat = @'
@echo off
title Hypervibe - Setup CLIs
SET PATH=C:\Program Files\nodejs;C:\Program Files\GitHub CLI;%USERPROFILE%\AppData\Roaming\npm;%PATH%

REM Status flags for each CLI (KO = not ready, OK = installed + connected)
set "STATUS_GH=KO"
set "STATUS_VERCEL=KO"
set "STATUS_WRANGLER=KO"

echo.
echo ============================================
echo  Hypervibe - Installation CLIs
echo ============================================

REM -----------------------------------------------
REM  [1/4] GitHub CLI (gh is an .exe, no call needed)
REM -----------------------------------------------
echo.
echo === [1/4] GitHub CLI ===
where gh >nul 2>&1
if not errorlevel 1 goto gh_check_auth
echo Installation...
winget install GitHub.cli --accept-package-agreements --accept-source-agreements

:gh_check_auth
gh auth status >nul 2>&1
if not errorlevel 1 goto gh_ok
echo.
echo Connexion GitHub - Choisis : GitHub.com, HTTPS, Login with a web browser
gh auth login
gh auth status >nul 2>&1
if errorlevel 1 goto gh_end

:gh_ok
set "STATUS_GH=OK"
echo [OK] GitHub CLI pret.

:gh_end

REM -----------------------------------------------
REM  [2/4] Vercel CLI (.cmd wrapper, needs call)
REM -----------------------------------------------
echo.
echo === [2/4] Vercel CLI ===
where vercel >nul 2>&1
if not errorlevel 1 goto vercel_check_auth
echo Installation...
call npm install -g vercel

:vercel_check_auth
call vercel whoami >nul 2>&1
if not errorlevel 1 goto vercel_ok
echo.
echo Connexion Vercel...
call vercel login
call vercel whoami >nul 2>&1
if errorlevel 1 goto vercel_end

:vercel_ok
set "STATUS_VERCEL=OK"
echo [OK] Vercel CLI pret.

:vercel_end

REM  (Resend CLI retiree - l'email passe par l'API Resend avec la cle du coffre-fort.)

REM -----------------------------------------------
REM  [3/3] Wrangler CLI (Cloudflare - Workers, R2)
REM  No login needed: wrangler picks up CLOUDFLARE_API_TOKEN
REM  env var (set by /start before this script runs).
REM -----------------------------------------------
echo.
echo === [4/4] Wrangler CLI (Cloudflare) ===
where wrangler >nul 2>&1
if not errorlevel 1 goto wrangler_check_auth
echo Installation...
call npm install -g wrangler

:wrangler_check_auth
REM whoami succeeds when CLOUDFLARE_API_TOKEN is set + valid
call wrangler whoami >nul 2>&1
if errorlevel 1 goto wrangler_no_token
set "STATUS_WRANGLER=OK"
echo [OK] Wrangler CLI pret (token Cloudflare detecte).
goto wrangler_end

:wrangler_no_token
echo.
echo [INFO] Wrangler installe mais le token Cloudflare n'est pas encore detecte.
echo Reviens dans Claude - il rangera le token Cloudflare dans ton coffre-fort.

:wrangler_end

REM -----------------------------------------------
REM  Rapport final
REM -----------------------------------------------
echo.
echo ============================================
echo  Rapport final
echo ============================================
if "%STATUS_GH%"=="OK" (echo   [OK] GitHub CLI) else (echo   [MANQUE] GitHub CLI - installation ou connexion incomplete)
if "%STATUS_VERCEL%"=="OK" (echo   [OK] Vercel CLI) else (echo   [MANQUE] Vercel CLI - installation ou connexion incomplete)
if "%STATUS_WRANGLER%"=="OK" (echo   [OK] Wrangler CLI ^(token Cloudflare OK^)) else (echo   [MANQUE] Wrangler CLI - install OK mais token Cloudflare manquant)
echo ============================================

if not "%STATUS_GH%"=="OK" goto incomplete
if not "%STATUS_VERCEL%"=="OK" goto incomplete
if not "%STATUS_WRANGLER%"=="OK" goto incomplete

echo.
echo Tout est installe et connecte !
echo Reviens dans Claude pour continuer.
goto end

:incomplete
echo.
echo Certains outils ne sont pas encore prets.
echo Reviens dans Claude - il te dira ce qui reste a faire
echo et proposera de relancer ce script pour finir.

:end
echo.
pause
'@

$tmpBat = "$env:TEMP\hypervibe-setup-clis.bat"
$bat | Out-File -FilePath $tmpBat -Encoding ascii
Start-Process cmd.exe -ArgumentList "/k `"$tmpBat`""

@echo off
cd /d %~dp0
echo === Instalare dependente (o singura data poate dura mai mult) ===
call npm install
echo === Pornesc aplicatia ===
call npm run dev
pause
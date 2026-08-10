# Start Agent (5173) and Admin (5174) together
Set-Location (Split-Path -Parent $PSScriptRoot)

Write-Host "Agent  -> http://127.0.0.1:5173"
Write-Host "Admin  -> http://127.0.0.1:5174"
Write-Host ""

Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PWD'; npm run dev:agent"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PWD'; npm run dev:admin"

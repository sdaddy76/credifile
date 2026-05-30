# ============================================================
# Credifile - Script Backup Automatico Documenti Pratiche
# Versione: 1.0 | Aggiornato: 2026
# ============================================================
# ISTRUZIONI:
# 1. Copia questo file sul tuo PC (es. C:\Credifile\credifile_backup.ps1)
# 2. Modifica le variabili CONFIGURAZIONE qui sotto
# 3. Per eseguirlo automaticamente: Utilità di pianificazione Windows
#    > Nuovo Attività > Trigger: All'accensione o ogni giorno
#    > Azione: powershell.exe -ExecutionPolicy Bypass -File "C:\Credifile\credifile_backup.ps1"
# ============================================================

# ---- CONFIGURAZIONE ----------------------------------------
$SUPABASE_URL      = "https://fhieppjqlefdlanvrpik.supabase.co"
$SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZoaWVwcGpxbGVmZGxhbnZycGlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwNTYxOTksImV4cCI6MjA5NTYzMjE5OX0.tM0B5OyxF1-w9ed1-eEX09S_d5gehZnFUZEJCnXMVBQ"
# Email e password del tuo account Credifile
$CREDIFILE_EMAIL   = "stefano@daddino.com"
$CREDIFILE_PASS    = ""   # <-- inserisci password
# Cartella di destinazione backup sul PC
$BACKUP_ROOT       = "C:\Credifile\Backup"
# Giorni di retention (backup più vecchi vengono eliminati)
$RETENTION_DAYS    = 30
# ---- FINE CONFIGURAZIONE -----------------------------------

$ErrorActionPreference = "Stop"
$Today = Get-Date -Format "yyyy-MM-dd"
$BackupDir = Join-Path $BACKUP_ROOT $Today

Write-Host "=== Credifile Backup - $Today ===" -ForegroundColor Cyan
Write-Host "Cartella destinazione: $BackupDir"

# Crea cartella se non esiste
if (-not (Test-Path $BackupDir)) { New-Item -ItemType Directory -Path $BackupDir | Out-Null }

# 1. Login Supabase
Write-Host "`n[1/5] Login..." -ForegroundColor Yellow
$loginBody = @{ email = $CREDIFILE_EMAIL; password = $CREDIFILE_PASS } | ConvertTo-Json
$loginResp = Invoke-RestMethod -Uri "$SUPABASE_URL/auth/v1/token?grant_type=password" `
    -Method POST -ContentType "application/json" -Body $loginBody `
    -Headers @{ "apikey" = $SUPABASE_ANON_KEY }
$ACCESS_TOKEN = $loginResp.access_token
if (-not $ACCESS_TOKEN) { Write-Error "Login fallito. Controlla email e password." }
Write-Host "Login OK" -ForegroundColor Green

$headers = @{ "Authorization" = "Bearer $ACCESS_TOKEN"; "apikey" = $SUPABASE_ANON_KEY }

# 2. Recupera pratiche
Write-Host "[2/5] Recupero pratiche..." -ForegroundColor Yellow
$practices = Invoke-RestMethod -Uri "$SUPABASE_URL/rest/v1/practices?select=id,numero_pratica,nome_richiedente" `
    -Method GET -Headers $headers
Write-Host "Pratiche trovate: $($practices.Count)"

# 3. Recupera file caricati
Write-Host "[3/5] Recupero lista file..." -ForegroundColor Yellow
$practiceIds = ($practices | ForEach-Object { $_.id }) -join '","'
$filesUrl = "$SUPABASE_URL/rest/v1/uploaded_files?select=id,nome_file,storage_path,practice_id&practice_id=in.(`"$practiceIds`")"
$files = Invoke-RestMethod -Uri $filesUrl -Method GET -Headers $headers
Write-Host "File trovati: $($files.Count)"

if ($files.Count -eq 0) { Write-Host "Nessun file da scaricare." -ForegroundColor Yellow; exit 0 }

# 4. Crea URL firmati e scarica
Write-Host "[4/5] Download file..." -ForegroundColor Yellow
$practiceMap = @{}
$practices | ForEach-Object { $practiceMap[$_.id] = $_ }
$downloaded = 0; $errors = 0

foreach ($f in $files) {
    $pr = $practiceMap[$f.practice_id]
    $folderName = if ($pr) { "$($pr.numero_pratica) - $($pr.nome_richiedente -replace '[\\/:*?"<>|]', '_')" } else { $f.practice_id }
    $destFolder = Join-Path $BackupDir $folderName
    if (-not (Test-Path $destFolder)) { New-Item -ItemType Directory -Path $destFolder | Out-Null }

    $destFile = Join-Path $destFolder $f.nome_file
    # Salta se già scaricato oggi
    if (Test-Path $destFile) { $downloaded++; continue }

    try {
        # Genera URL firmato
        $signBody = @{ expiresIn = 3600 } | ConvertTo-Json
        $signResp = Invoke-RestMethod -Uri "$SUPABASE_URL/storage/v1/object/sign/practice-files/$($f.storage_path)" `
            -Method POST -ContentType "application/json" -Body $signBody -Headers $headers
        $signedUrl = "$SUPABASE_URL/storage/v1$($signResp.signedURL)"
        Invoke-WebRequest -Uri $signedUrl -OutFile $destFile
        $downloaded++
        Write-Host "  OK: $($f.nome_file)" -ForegroundColor Green
    } catch {
        $errors++
        Write-Warning "  SKIP: $($f.nome_file) - $($_.Exception.Message)"
    }
}

Write-Host "[5/5] Backup completato: $downloaded file scaricati, $errors errori" -ForegroundColor Cyan

# 5. Pulizia backup vecchi
Write-Host "Pulizia backup più vecchi di $RETENTION_DAYS giorni..." -ForegroundColor Yellow
$cutoff = (Get-Date).AddDays(-$RETENTION_DAYS)
Get-ChildItem -Path $BACKUP_ROOT -Directory | Where-Object { $_.CreationTime -lt $cutoff } | ForEach-Object {
    Remove-Item -Path $_.FullName -Recurse -Force
    Write-Host "  Eliminato: $($_.Name)"
}

# Log
$logFile = Join-Path $BACKUP_ROOT "backup_log.txt"
"[$Today $(Get-Date -Format 'HH:mm:ss')] OK - $downloaded file scaricati, $errors errori" | Add-Content $logFile
Write-Host "`nLog aggiornato: $logFile" -ForegroundColor Gray
Write-Host "=== Fine Backup ===" -ForegroundColor Cyan

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Sawant Group ERP - EC2 Backend Deployment Script (Sample)" -ForegroundColor Cyan
Write-Host "  Copy this file to deploy_to_ec2.ps1 and set your secrets" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

# Set via environment variables or define in local deploy_to_ec2.ps1 (git ignored)
$KEY = if ($env:EC2_KEY_PATH) { $env:EC2_KEY_PATH } else { "C:\path\to\your-key.pem" }
$EC2 = if ($env:EC2_HOST) { $env:EC2_HOST } else { "ec2-user@YOUR_EC2_IP" }
$REMOTE_PATH = "/app/sawant-erp-backend"
$LOCAL_API = "$PSScriptRoot\apps\api"
$STAGING = "/home/ec2-user/sawant-erp-deploy-tmp"
$ARCHIVE = "$PSScriptRoot\sawant-erp-api-build.tar.gz"

if (-not (Test-Path $KEY)) {
    Write-Host "ERROR: Key file not found at $KEY. Please configure EC2_KEY_PATH." -ForegroundColor Red
    exit 1
}

# Step 1: Build local TypeScript backend
Write-Host "Step 1: Building local backend (apps/api)..." -ForegroundColor Yellow
Push-Location $LOCAL_API
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed! Aborting deployment." -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location
Write-Host "  Local build successful." -ForegroundColor Green

# Step 2: Package deployment archive (dist, package.json, prisma)
Write-Host ""
Write-Host "Step 2: Packaging backend archive..." -ForegroundColor Yellow
if (Test-Path $ARCHIVE) { Remove-Item -Force $ARCHIVE }

tar --exclude="node_modules" --exclude="tests" --exclude="*.tsbuildinfo" -czf $ARCHIVE -C "$LOCAL_API" dist package.json package-lock.json prisma

Write-Host "  Archive created: $ARCHIVE" -ForegroundColor Green

# Step 3: Create staging and remote directory on EC2
Write-Host ""
Write-Host "Step 3: Preparing directories on EC2..." -ForegroundColor Yellow
ssh -i $KEY -o StrictHostKeyChecking=no $EC2 "mkdir -p $STAGING && sudo mkdir -p $REMOTE_PATH && sudo chown -R ec2-user:ec2-user $REMOTE_PATH"
if ($LASTEXITCODE -ne 0) {
    Write-Host "SSH command failed. Check connection." -ForegroundColor Red
    exit 1
}
Write-Host "  Directories ready." -ForegroundColor Green

# Step 4: Upload archive to staging
Write-Host ""
Write-Host "Step 4: Uploading archive to EC2 staging..." -ForegroundColor Yellow
scp -i $KEY -o StrictHostKeyChecking=no $ARCHIVE "${EC2}:${STAGING}/backend.tar.gz"
if ($LASTEXITCODE -ne 0) {
    Write-Host "SCP upload failed!" -ForegroundColor Red
    exit 1
}
Write-Host "  Upload complete." -ForegroundColor Green

# Step 5: Extract on remote server, configure env, install production dependencies, restart PM2
Write-Host ""
Write-Host "Step 5: Extracting and deploying on EC2..." -ForegroundColor Yellow

$remoteScript = @"
set -e
echo '--- Extracting files to $REMOTE_PATH ---'
tar -xzf $STAGING/backend.tar.gz -C $REMOTE_PATH

cd $REMOTE_PATH

echo '--- Installing production packages ---'
npm install --omit=dev --no-audit --prefer-offline 2>&1 | tail -n 5 || npm install --omit=dev

echo '--- Generating Prisma client ---'
npx prisma generate

echo '--- Managing PM2 process: sawant-erp-backend ---'
pm2 restart sawant-erp-backend 2>/dev/null || pm2 start dist/server.js --name "sawant-erp-backend" --time

echo '--- Checking PM2 status ---'
pm2 show sawant-erp-backend | grep -E 'status|uptime|restarts'

echo '--- Cleaning staging ---'
rm -rf $STAGING

echo '=== BACKEND DEPLOYMENT COMPLETE ON PORT 5010 ==='
"@

ssh -i $KEY -o StrictHostKeyChecking=no $EC2 $remoteScript
if ($LASTEXITCODE -eq 0) {
    Write-Host "=== DEPLOYMENT SUCCESSFUL! ===" -ForegroundColor Green
} else {
    Write-Host "Deployment encountered errors. Review output above." -ForegroundColor Red
}

if (Test-Path $ARCHIVE) { Remove-Item -Force $ARCHIVE }

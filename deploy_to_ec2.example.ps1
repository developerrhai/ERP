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
ssh -i $KEY -o StrictHostKeyChecking=accept-new $EC2 "mkdir -p $STAGING && sudo mkdir -p $REMOTE_PATH && sudo chown -R ec2-user:ec2-user $REMOTE_PATH"
if ($LASTEXITCODE -ne 0) {
    Write-Host "SSH command failed. Check connection." -ForegroundColor Red
    exit 1
}
Write-Host "  Directories ready." -ForegroundColor Green

# Step 4: Upload archive to staging
Write-Host ""
Write-Host "Step 4: Uploading archive to EC2 staging..." -ForegroundColor Yellow
scp -i $KEY -o StrictHostKeyChecking=accept-new $ARCHIVE "${EC2}:${STAGING}/backend.tar.gz"
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

# The prisma CLI is a devDependency; pin it to the exact version the app was built with (see docs/DEPLOYMENT-REVIEW.md D13)
PRISMA_VERSION=`$(node -p "require('./package.json').devDependencies.prisma")

echo '--- Generating Prisma client ---'
npx --yes prisma@`$PRISMA_VERSION generate

echo '--- Applying database migrations (D4) ---'
npx --yes prisma@`$PRISMA_VERSION migrate deploy

echo '--- Managing PM2 process: sawant-erp-backend ---'
pm2 restart sawant-erp-backend --update-env 2>/dev/null || pm2 start dist/server.js --name "sawant-erp-backend" --time

echo '--- Health check (D8) ---'
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS http://127.0.0.1:5010/api/v1/health | grep -q '"ok"'; then echo 'API healthy'; break; fi
  if [ `$i -eq 10 ]; then echo 'API NOT HEALTHY after restart - check: pm2 logs sawant-erp-backend'; exit 1; fi
  sleep 2
done

echo '--- Cleaning staging ---'
rm -rf $STAGING

echo '=== BACKEND DEPLOYMENT COMPLETE ON PORT 5010 ==='
"@

# accept-new: trust the server key on first connect, refuse if it ever changes (D7)
ssh -i $KEY -o StrictHostKeyChecking=accept-new $EC2 $remoteScript
if ($LASTEXITCODE -eq 0) {
    Write-Host "=== DEPLOYMENT SUCCESSFUL! ===" -ForegroundColor Green
} else {
    Write-Host "Deployment encountered errors. Review output above." -ForegroundColor Red
}

if (Test-Path $ARCHIVE) { Remove-Item -Force $ARCHIVE }

#!/usr/bin/env bash
# อัปเดตเว็บโหมด Supabase ขึ้น VPS (Docker + Traefik)
# ใช้: PIRCH_HOST=root@your-vps PIRCH_DOMAIN=chat.example.com ./deploy/deploy.sh   (รันจากโฟลเดอร์โปรเจกต์)
set -euo pipefail
: "${PIRCH_HOST:?ตั้ง PIRCH_HOST เช่น root@your-vps}"
: "${PIRCH_DOMAIN:?ตั้ง PIRCH_DOMAIN เช่น chat.example.com}"
DIR="${PIRCH_DIR:-/docker/pirch98}"
ssh "$PIRCH_HOST" "mkdir -p $DIR"
rsync -a --chmod=D755,F644 public deploy "$PIRCH_HOST:$DIR/"
ssh "$PIRCH_HOST" "cd $DIR/deploy && DOMAIN=$PIRCH_DOMAIN docker compose -p pirch98 up -d"
echo "OK → https://$PIRCH_DOMAIN"

#!/bin/bash -e 

echo "Stopping the engine..."
systemctl stop fabmo

echo "Clearing settings..."
rm -rf /opt/fabmo/engine

echo "Uninstalling engine..."
rm -rf /fabmo/engine

echo "Cloning new copy of the engine..."
git clone $1 /fabmo/engine
cd /fabmo/engine
git fetch origin --tags
git pull

echo "Updating to version $2..."
git checkout $2
sync

echo "Installing dependencies..."
npm install --production

echo "Enabling network manager for new installation..."
echo '{"wifi_manager":true}' > /opt/fabmo/config/engine.json
sync

echo "Restarting the engine..."
systemctl start fabmo

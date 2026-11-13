#!/bin/bash
# Copies every .txt file in the home directory into ~/archive
set -euo pipefail
dest=~/archive
mkdir -p "$dest"
for f in ~/*.txt; do
  cp "$f" "$dest/"
  echo "backed up $(basename "$f")"
done

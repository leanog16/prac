#!/bin/bash
# Usage: greet.sh NAME [GREETING]
name=${1:-stranger}
greeting=${2:-Hello}
echo "$greeting, $name!"

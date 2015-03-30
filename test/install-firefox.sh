#!/bin/bash

if [ "$FIREFOXVERSION" = "stable" ] ; then
  sudo apt-get install firefox
elif [ "$FIREFOXVERSION" = "ESR" ] ; then
  local ESR_VERSION="31.5.0esr"
  wget http://ftp.mozilla.org/pub/firefox/releases/${ESR_VERSION}/linux-x86_64/en-US/firefox-${ESR_VERSION}.tar.bz2
  tar -xjf firefox-${ESR_VERSION}.tar.bz2
  FX_EXECUTABLE="firefox/firefox"
elif [ "$FIREFOXVERSION" = "beta" ] ; then
  sudo add-apt-repository ppa:mozillateam/firefox-next -y
  sudo apt-get update -q
  sudo apt-get install firefox
elif [ "$FIREFOXVERSION" = "aurora" ] ; then
  sudo add-apt-repository ppa:ubuntu-mozilla-daily/firefox-aurora -y
  sudo apt-get update -q
  sudo apt-get install firefox
fi

if [ -z "$FX_EXECUTABLE" ] ; then
  FX_EXECUTABLE="`which firefox`"
fi

echo "Installed Firefox  at $FX_EXECUTABLE"
"$FX_EXECUTABLE" -v
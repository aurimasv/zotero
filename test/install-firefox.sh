#!/bin/bash

if [ "$FIREFOXVERSION" = "ESR" ] ; then
  ESR_VERSION="31.5.0esr"
  wget http://ftp.mozilla.org/pub/firefox/releases/${ESR_VERSION}/linux-x86_64/en-US/firefox-${ESR_VERSION}.tar.bz2
  tar -xjf firefox-${ESR_VERSION}.tar.bz2
  FX_EXECUTABLE="`readlink -f firefox/firefox`"
elif [ "$FIREFOXVERSION" = "stable" ] || [ "$FIREFOXVERSION" = "beta" ] || [ "$FIREFOXVERSION" = "aurora" ] ; then
  if [ "$FIREFOXVERSION" = "beta" ] ; then
    sudo add-apt-repository ppa:mozillateam/firefox-next -y
  elif [ "$FIREFOXVERSION" = "aurora" ] ; then
    sudo add-apt-repository ppa:ubuntu-mozilla-daily/firefox-aurora -y
  fi
  sudo apt-get update -q
  sudo apt-get install firefox -V --reinstall
  FX_EXECUTABLE="/usr/bin/firefox"
fi

export FX_EXECUTABLE

echo "Installed Firefox  at $FX_EXECUTABLE"
"$FX_EXECUTABLE" -v
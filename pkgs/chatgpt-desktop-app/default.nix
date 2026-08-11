{
  lib,
  stdenv,
  fetchurl,
  dpkg,
  asar,
  autoPatchelfHook,
  makeWrapper,
  wrapGAppsHook3,
  alsa-lib,
  at-spi2-core,
  cairo,
  cups,
  dbus,
  expat,
  fontconfig,
  freetype,
  gdk-pixbuf,
  git,
  glib,
  gtk3,
  libdrm,
  libgbm,
  libGL,
  libnotify,
  libpulseaudio,
  libsecret,
  libusb1,
  libuuid,
  libva,
  libxkbcommon,
  libx11,
  libxscrnsaver,
  libxcomposite,
  libxcursor,
  libxdamage,
  libxext,
  libxfixes,
  libxi,
  libxrandr,
  libxrender,
  libxtst,
  libxcb,
  mesa,
  nspr,
  nss,
  openssh,
  pango,
  systemd,
  trash-cli,
  vulkan-loader,
  wayland,
  xdg-utils,
}:

let
  sources = import ./sources.nix;
  source =
    sources.platforms.${stdenv.hostPlatform.system}
      or (throw "chatgpt-desktop-app is not packaged for ${stdenv.hostPlatform.system}");

  runtimeLibs = [
    alsa-lib
    at-spi2-core
    cairo
    cups
    dbus
    expat
    fontconfig
    freetype
    gdk-pixbuf
    glib
    gtk3
    libdrm
    libgbm
    libGL
    libnotify
    libpulseaudio
    libsecret
    libusb1
    libuuid
    libva
    libxkbcommon
    mesa
    nspr
    nss
    pango
    stdenv.cc.cc.lib
    systemd
    vulkan-loader
    wayland
    libx11
    libxscrnsaver
    libxcomposite
    libxcursor
    libxdamage
    libxext
    libxfixes
    libxi
    libxrandr
    libxrender
    libxtst
    libxcb
  ];

  runtimeBins = [
    git
    glib
    openssh
    trash-cli
    xdg-utils
  ];
in
stdenv.mkDerivation {
  pname = "chatgpt-desktop-app";
  inherit (sources) version;

  src = fetchurl {
    url = "https://persistent.oaistatic.com/codex-app-prod/linux/deb/latest/chatgpt_${source.debArch}.deb";
    inherit (source) hash;
  };

  nativeBuildInputs = [
    dpkg
    asar
    autoPatchelfHook
    makeWrapper
    wrapGAppsHook3
  ];

  buildInputs = runtimeLibs;

  dontConfigure = true;
  dontBuild = true;
  dontStrip = true;
  dontWrapGApps = true;

  unpackPhase = ''
    runHook preUnpack
    dpkg-deb --fsys-tarfile "$src" | tar --extract --file - --no-same-permissions
    runHook postUnpack
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/lib" "$out/share"
    cp -a usr/lib/chatgpt "$out/lib/"
    cp -a usr/share/applications usr/share/doc usr/share/pixmaps "$out/share/"

    # Patchelf relocates Electron's Nix store interpreter past the first 2 KiB
    # of the executable. The bundled detect-libc cannot find it there, and its
    # process.report fallback aborts in Electron's worker thread. Let it detect
    # glibc through the Nix-provided ldd instead.
    asar extract usr/lib/chatgpt/resources/app.asar app
    substituteInPlace \
      app/node_modules/@parcel/watcher/node_modules/detect-libc/lib/filesystem.js \
      --replace-fail "/usr/bin/ldd" "${lib.getBin stdenv.cc.libc}/bin/ldd"
    asar pack app "$TMPDIR/app.asar" \
      --unpack-dir "{node_modules/@parcel,node_modules/@worklouder,node_modules/better-sqlite3,node_modules/node-pty}"
    cp "$TMPDIR/app.asar" "$out/lib/chatgpt/resources/app.asar"
    cp -a "$TMPDIR/app.asar.unpacked/." \
      "$out/lib/chatgpt/resources/app.asar.unpacked/"

    substituteInPlace "$out/share/applications/chatgpt.desktop" \
      --replace-fail "Exec=chatgpt %U" "Exec=$out/bin/chatgpt %U"

    runHook postInstall
  '';

  # The Qt shims are optional Chromium integrations. The official Debian
  # package itself does not depend on Qt, so keep them optional on Nix too.
  autoPatchelfIgnoreMissingDeps = [
    "libQt5Core.so.5"
    "libQt5Gui.so.5"
    "libQt5Widgets.so.5"
    "libQt6Core.so.6"
    "libQt6Gui.so.6"
    "libQt6Widgets.so.6"
    # The upstream payload includes musl and glibc prebuilds side-by-side.
    # Nix uses the glibc variants on these supported systems.
    "libc.musl-x86_64.so.1"
    "libc.musl-aarch64.so.1"
  ];

  preFixup = ''
    gappsWrapperArgs+=(
      --suffix PATH : ${lib.makeBinPath runtimeBins}
      --prefix LD_LIBRARY_PATH : ${lib.makeLibraryPath runtimeLibs}
      --set-default ELECTRON_OZONE_PLATFORM_HINT auto
    )
  '';

  postFixup = ''
    makeWrapper "$out/lib/chatgpt/codex-launcher" "$out/bin/chatgpt" \
      "''${gappsWrapperArgs[@]}"
  '';

  passthru = {
    updateScript = ../../scripts/update.sh;
    inherit sources;
  };

  meta = {
    description = "OpenAI's official ChatGPT Desktop App for Linux";
    longDescription = ''
      The official, native Linux build of ChatGPT Desktop App published by
      OpenAI. This package extracts OpenAI's Debian package and adapts its
      runtime paths for Nix; it is not a web wrapper or a macOS/Windows repack.
    '';
    homepage = "https://openai.com/codex/";
    downloadPage = "https://developers.openai.com/codex/app";
    license = lib.licenses.unfree;
    mainProgram = "chatgpt";
    platforms = builtins.attrNames sources.platforms;
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
    maintainers = [ ];
  };
}

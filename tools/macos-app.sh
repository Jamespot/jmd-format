#!/usr/bin/env bash
# Builds "James JMD.app" — the double-click opener for .jmd on macOS, like PowerPoint for .pptx.
# The app embeds the runtime (james-jmd.html) and needs NOTHING on the user's machine: on open it injects the
# .jmd into the runtime with perl (shipped with macOS), writes <slug>.james-jmd.html to ~/Library/Caches/James JMD/,
# and opens it in the default browser. It registers itself as the handler for .jmd.
# usage: tools/macos-app.sh [output dir]   (default ~/Applications; needs node only HERE, to build the runtime)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:-$HOME/Applications}"
APP="$DEST/James JMD.app"
node "$ROOT/tools/build.mjs" >/dev/null
mkdir -p "$DEST"; rm -rf "$APP"
TMP="$(mktemp -d)"
cat > "$TMP/main.applescript" <<'APPLESCRIPT'
on open theFiles
  repeat with f in theFiles
    my render(POSIX path of f)
  end repeat
end open
on run
  set f to choose file with prompt "Open a .jmd presentation" of type {"jmd", "public.plain-text", "net.daringfireball.markdown"}
  my render(POSIX path of f)
end run
on render(p)
  set res to POSIX path of (path to resource "james-jmd.html")
  set opener to POSIX path of (path to resource "open.sh")
  do shell script "/bin/sh " & quoted form of opener & " " & quoted form of res & " " & quoted form of p
end render
APPLESCRIPT
osacompile -o "$APP" "$TMP/main.applescript"
RES="$APP/Contents/Resources"
cp "$ROOT/build/james-jmd.html" "$RES/james-jmd.html"
cat > "$RES/open.sh" <<'SH'
#!/bin/sh
# $1 = runtime template, $2 = the .jmd. Injects the source, writes the self-contained page, opens it.
TEMPLATE="$1"; SRC="$2"
NAME="$(basename "$SRC")"; SLUG="${NAME%.jmd}"
OUT_DIR="$HOME/Library/Caches/James JMD"; mkdir -p "$OUT_DIR"
OUT="$OUT_DIR/$SLUG.james-jmd.html"
perl -e '
  local $/;
  open(my $s, "<:raw", $ARGV[1]) or die; my $src = <$s>; close $s;
  $src =~ s{</script}{<\\/script}gi; $src =~ s/\n\z//;
  open(my $t, "<:raw", $ARGV[0]) or die; my $tpl = <$t>; close $t;
  my $name = $ARGV[2]; $name =~ s/"/&quot;/g;
  $tpl =~ s{(<script type="text/jmd" id="jmd")[^>]*>\n?}{ $1 . qq{ data-name="$name">\n} . $src . "\n" }e;
  print $tpl;
' "$TEMPLATE" "$SRC" "$NAME" > "$OUT"
open "$OUT"
SH
chmod +x "$RES/open.sh"
PLIST="$APP/Contents/Info.plist"
pb() { /usr/libexec/PlistBuddy -c "$1" "$PLIST" >/dev/null 2>&1 || true; }
pb "Set :CFBundleName James JMD"
pb "Add :CFBundleIdentifier string com.jamespot.james-jmd"; pb "Set :CFBundleIdentifier com.jamespot.james-jmd"
pb "Delete :CFBundleDocumentTypes"
pb "Add :CFBundleDocumentTypes array"
pb "Add :CFBundleDocumentTypes:0 dict"
pb "Add :CFBundleDocumentTypes:0:CFBundleTypeName string 'JMD presentation'"
pb "Add :CFBundleDocumentTypes:0:CFBundleTypeRole string Viewer"
pb "Add :CFBundleDocumentTypes:0:LSHandlerRank string Owner"
pb "Add :CFBundleDocumentTypes:0:LSItemContentTypes array"
pb "Add :CFBundleDocumentTypes:0:LSItemContentTypes:0 string com.jamespot.jmd"
pb "Add :UTExportedTypeDeclarations array"
pb "Add :UTExportedTypeDeclarations:0 dict"
pb "Add :UTExportedTypeDeclarations:0:UTTypeIdentifier string com.jamespot.jmd"
pb "Add :UTExportedTypeDeclarations:0:UTTypeDescription string 'JMD presentation'"
pb "Add :UTExportedTypeDeclarations:0:UTTypeConformsTo array"
pb "Add :UTExportedTypeDeclarations:0:UTTypeConformsTo:0 string net.daringfireball.markdown"
pb "Add :UTExportedTypeDeclarations:0:UTTypeConformsTo:1 string public.plain-text"
pb "Add :UTExportedTypeDeclarations:0:UTTypeTagSpecification dict"
pb "Add :UTExportedTypeDeclarations:0:UTTypeTagSpecification:public.filename-extension array"
pb "Add :UTExportedTypeDeclarations:0:UTTypeTagSpecification:public.filename-extension:0 string jmd"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP" >/dev/null 2>&1 || true
rm -rf "$TMP"
echo "$APP"

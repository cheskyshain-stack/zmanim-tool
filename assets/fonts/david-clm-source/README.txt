David CLM Medium, Culmus 0.140

Font project: https://culmus.sourceforge.io/
Upstream release: https://sourceforge.net/projects/culmus/files/culmus/0.140/
Release archive used: https://deb.debian.org/debian/pool/main/c/culmus/culmus_0.140.orig.tar.gz

DavidCLM-Medium.otf is the unaltered upstream font, provided as the source
for ../david-clm-medium.woff2. The WOFF2 file is a webfont container conversion
made with FontTools and Brotli. Glyph outlines, font names, and copyright
metadata are preserved. LICENSE.txt contains the upstream copyright notices,
Bitstream license, and GNU General Public License version 2.

To regenerate from this directory, with fonttools and brotli installed:

python -c "from fontTools.ttLib import TTFont; f=TTFont('DavidCLM-Medium.otf'); f.flavor='woff2'; f.save('../david-clm-medium.woff2')"

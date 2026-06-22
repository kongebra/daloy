# ClusterFuzzLite build image for @daloyjs/core fuzz targets.
#
# Pinned by digest (not a floating tag) so OpenSSF Scorecard's
# Pinned-Dependencies check stays at 10. Refresh the digest periodically — see
# .clusterfuzzlite/README.md ("Maintaining the base image pin").
FROM gcr.io/oss-fuzz-base/base-builder-javascript@sha256:7bfe348361b49d8cff39efa6b657c0add7227fa80648b0493d2719ff2a9b7160

# Copy the whole repo so build.sh can compile the framework to dist/.
COPY . $SRC/daloy
WORKDIR $SRC/daloy

# The OSS-Fuzz `compile` entrypoint runs $SRC/build.sh.
COPY .clusterfuzzlite/build.sh $SRC/

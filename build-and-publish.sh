#!/bin/bash

# Build script that includes git commit hash
# Usage: ./build.sh [tag_name]

set -e

# Get the current git commit hash
GIT_COMMIT=$(git rev-parse HEAD)
echo "Building with git commit: $GIT_COMMIT"

echo "Building Docker image"

# Build the Docker image with git commit hash as build argument
docker build \
  --build-arg GIT_COMMIT="$GIT_COMMIT" \
  -t "$1" \
  .

echo "Build completed successfully!"
echo "Image: $1"
echo "Git commit: $GIT_COMMIT"

docker push "$1"
echo "Image pushed to registry: $1"
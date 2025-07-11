# Stage 1: Build the frontend
FROM node:20-slim AS frontend-builder

WORKDIR /frontend

# Copy only the frontend folder
COPY frontend/package*.json ./
RUN npm install

COPY frontend/ ./
RUN npm run build

# Then build the application in the `/app` directory
FROM ghcr.io/astral-sh/uv:bookworm-slim AS builder
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy

# Configure the Python directory so it is consistent
ENV UV_PYTHON_INSTALL_DIR=/python

# Only use the managed Python version
ENV UV_PYTHON_PREFERENCE=only-managed

# Install Python before the project for caching
RUN uv python install 3.12

WORKDIR /app
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --locked --no-install-project --no-dev
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev

# Then, use a final image without uv
FROM debian:bookworm-slim

RUN apt-get update && apt-get install ffmpeg libsm6 libxext6 -y

# Copy the Python version
COPY --from=builder /python /python

# Copy the application from the builder
COPY --from=builder /app/.venv /app/.venv
COPY backend /app/backend

# Copy built frontend into the backend's static directory (adjust path as needed)
COPY --from=frontend-builder /frontend/build /app/backend/dist

# Place executables in the environment at the front of the path
ENV PATH="/app/.venv/bin:$PATH"

ARG GIT_COMMIT=unknown
ENV GIT_COMMIT=$GIT_COMMIT

WORKDIR /app/backend

CMD ["python", "app.py"]
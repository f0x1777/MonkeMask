# MonkeMask API — FastAPI backend that runs the monkepic ML pipeline.
# Deployed to a host that allows the ML deps (Railway/Fly); Vercel can't run it.
FROM python:3.12-slim

# System libs OpenCV / onnxruntime need at runtime (headless server has no X).
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 libgl1 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first (better layer caching).
COPY pyproject.toml ./
COPY src ./src
COPY apps/api ./apps/api
COPY MonkeDAO_DAOJones.png ./MonkeDAO_DAOJones.png

# opencv-python pulls GUI deps; use the headless build on the server.
RUN pip install --no-cache-dir \
        "Pillow>=10.0" "pillow-heif>=0.16" "numpy>=1.24" \
        "opencv-python-headless>=4.9" "rembg>=2.0" "onnxruntime>=1.16" \
        "insightface>=0.7" \
        "fastapi>=0.110" "uvicorn>=0.29" "python-multipart>=0.0.9" \
    && pip install --no-cache-dir -e . --no-deps

# Pre-download the rembg U2Net weights at build time so first request is fast.
RUN python -c "from rembg import new_session; new_session('u2net')" || true

ENV PORT=8000
EXPOSE 8000

# Railway provides $PORT; bind to it.
CMD ["sh", "-c", "uvicorn apps.api.main:app --host 0.0.0.0 --port ${PORT:-8000}"]

FROM postgres:18.3-bookworm

# Install extensions via packages
RUN apt-get update && apt-get install -y \
    postgresql-18-postgis-3 \
    postgresql-18-postgis-3-scripts \
    postgresql-18-pgvector \
    postgresql-18-cron \
    # Build dependencies for Apache AGE
    build-essential \
    postgresql-server-dev-18 \
    libreadline-dev \
    zlib1g-dev \
    flex \
    bison \
    git \
    && rm -rf /var/lib/apt/lists/*

# Compile and install Apache AGE
# In 2026, we use the master branch which supports PG 18
RUN git clone https://github.com/apache/age.git /tmp/age \
    && cd /tmp/age \
    && make install \
    && rm -rf /tmp/age

# Configuration for Apache AGE and pg_cron
RUN echo "shared_preload_libraries = 'age, pg_cron'" >> /usr/share/postgresql/postgresql.conf.sample

# Initialization script
COPY init-db.sql /docker-entrypoint-initdb.d/

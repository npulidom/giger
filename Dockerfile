# ! base stage (LTS stable)
FROM node:lts-bookworm-slim AS base

# libcap & open port 80 as user node
RUN apt-get update && \
	apt-get install -y libcap2-bin && \
	apt-get clean && \
	setcap 'cap_net_bind_service=+ep' /usr/local/bin/node

# install deps
RUN apt-get update && \
	apt-get install -y \
	libjpeg62-turbo \
	pngquant \
	# clean
	&& apt-get clean

# app directory
WORKDIR /home/node/app

# copy node packages
COPY package.json .

# package lock file
RUN npm i --package-lock-only

# tmp directory, set write folder owner
RUN mkdir -p tmp && chown node tmp

# term env-var
ENV TERM=xterm
# build id argument
ARG BUILD_ID
ENV BUILD_ID=$BUILD_ID

# ! production stage
FROM base AS prod

ENV NODE_ENV=production

# install deps
RUN npm ci --omit=dev && npm cache clean --force

# copy app
COPY . .

# switch user
USER node

# cmd
CMD ["node", "init.js"]

# ! development stage
FROM base AS dev

ENV NODE_ENV=development

# install nodemon & deps
RUN npm i -g nodemon && \
	npm ci --omit=dev && npm cache clean --force

# copy app
COPY . .

# switch user
USER node

# cmd
CMD ["nodemon", "init.js"]

FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY *.js ./
COPY public ./public
COPY cuefield ./cuefield
COPY qishui-audio-decryptor ./qishui-audio-decryptor
COPY qishui-auth-v6 ./qishui-auth-v6
COPY ios-support/cloud-server.js ./ios-support/cloud-server.js
COPY LICENSE NOTICE.md ./

RUN mkdir -p /data/beatmaps /data/wallpapers /data/updates

EXPOSE 3000
CMD ["node", "ios-support/cloud-server.js"]

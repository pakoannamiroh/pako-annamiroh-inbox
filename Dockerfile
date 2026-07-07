FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js lead-classification-utils.js ./
COPY public ./public
ENV PORT=3100
EXPOSE 3100
CMD ["node", "server.js"]

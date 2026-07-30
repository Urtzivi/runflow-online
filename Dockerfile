FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 DEMO_MODE=0
EXPOSE 8787
CMD ["npm", "start"]

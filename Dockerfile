FROM mcr.microsoft.com/playwright:v1.42.1-jammy

WORKDIR /app

COPY package*.json ./
RUN npm install

# Instalar navegadores de Playwright (necesario para scraping de Mi Vending)
RUN npx playwright install chromium --with-deps

COPY . .

RUN mkdir -p /app/data

EXPOSE 3000

CMD ["node", "src/server.js"]

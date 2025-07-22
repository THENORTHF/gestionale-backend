# Dockerfile for gestionale-backend
FROM node:18-alpine

# Crea la cartella di lavoro
WORKDIR /app

# Copia i package.json e installa le dipendenze di produzione
COPY package*.json ./
RUN npm install --omit=dev

# Copia tutto il codice
COPY . .

# Assicura la variabile PORT (Railway la sovrascriverà con quella vera)
ENV PORT=8080
EXPOSE 8080

# Comando di avvio
CMD ["npm", "start"]

FROM node:22-bookworm-slim

# Dependențe externe
RUN apt-get update && apt-get install -y \
    && rm -rf /var/lib/apt/lists/*

# Creez utilizatorului razvan-anghel 
RUN useradd -m -s /bin/bash razvan-anghel

# Setez directorul de lucru în home-ul utilizatorului
WORKDIR /home/razvan-anghel/app

# Copiez fișierele de dependențe și le instalez
COPY package*.json ./
RUN npm install

# Copiez restul codului sursă
COPY . .

# Schimb proprietarul fișierelor
RUN chown -R razvan-anghel:razvan-anghel /home/razvan-anghel/app

# Trec la utilizatorul non-root 
USER razvan-anghel
EXPOSE 3000

# Pornirea serverului
CMD ["node", "src/server.js"]
FROM node:22-bookworm-slim

# Creez utilizatorului razvan-anghel-authx și setez directorul de lucru
RUN useradd -m -s /bin/bash razvan-anghel-authx
WORKDIR /home/razvan-anghel-authx/app

# Copiez și instalez dependințele
COPY package.json ./
RUN npm install

# Copiez restul codului sursă
COPY . .

# Schimb proprietarul fișierelor
RUN chown -R razvan-anghel-authx:razvan-anghel-authx /home/razvan-anghel-authx/app

# Trec la utilizatorul non-root 
USER razvan-anghel-authx
EXPOSE 3000

# Pornesc serverul
CMD ["node", "src/server.js"]

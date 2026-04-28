FROM node:22-bookworm-slim

# Creez utilizatorului razvan-anghel-authx 
RUN useradd -m -s /bin/bash razvan-anghel-authx

# Setez directorul de lucru în home-ul utilizatorului
WORKDIR /home/razvan-anghel-authx/app

# Copiez fisierele de dependinte
COPY package.json ./

# Instalez dependintele
RUN npm install

# Copiez restul codului sursă
COPY . .

# Schimb proprietarul fișierelor
RUN chown -R razvan-anghel-authx:razvan-anghel-authx /home/razvan-anghel-authx/app

# Trec la utilizatorul non-root 
USER razvan-anghel-authx
EXPOSE 3000

# Pornirea serverului
CMD ["node", "src/server.js"]

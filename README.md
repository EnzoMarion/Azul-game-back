# Azul — Infinity Stones 🌀

Jeu de plateau Azul en ligne multijoueur (2 à 4 joueurs), jouable en temps réel via WebSockets.  
Basé sur les règles officielles d'Azul avec un thème Infinity Stones.

---

## Stack technique

| Rôle | Technologie | Version |
|------|-------------|---------|
| Framework front | React | 18.3.1 |
| Bundler | Vite | 5.4.11 |
| Routing | React Router DOM | 7.9.6 |
| State management | Redux Toolkit | 2.2.7 |
| CSS | Sass | 1.81.0 |
| WebSocket client | socket.io-client | 4.8.3 |
| Runtime back | Node.js | ≥ 18.x |
| WebSocket serveur | socket.io | 4.8.3 |
| Serveur HTTP | Express | 4.22.2 |

---

## Prérequis

- **Node.js** ≥ 18 — [https://nodejs.org](https://nodejs.org)
- **npm** ≥ 9 (inclus avec Node.js)

Vérifier les versions installées :

```bash
node -v
npm -v
```

---

## Structure du projet

```
/
├── Azul-game-front/   # Front React + Vite
└── Azul-game-back/    # Serveur Node.js + Socket.io
```

Dépôts GitHub :
- Front : https://github.com/EnzoMarion/Azul-game-front
- Back  : https://github.com/EnzoMarion/Azul-game-back

---

## Installation

### 1. Cloner les deux dépôts

```bash
git clone https://github.com/EnzoMarion/Azul-game-front.git
git clone https://github.com/EnzoMarion/Azul-game-back.git
```

### 2. Installer les dépendances — Back

```bash
cd Azul-game-back
npm install
```

Dépendances installées : `socket.io@^4.8.3`, `express@^4.22.2`

### 3. Installer les dépendances — Front

```bash
cd ../Azul-game-front
npm install
```

Dépendances installées : `react@^18.3.1`, `react-dom`, `react-router-dom@^7.9.6`, `@reduxjs/toolkit@^2.2.7`, `react-redux@^9.1.2`, `socket.io-client@^4.8.3`, `sass@^1.81.0`

---

## Lancement

Ouvrir **deux terminaux** :

### Terminal 1 — Serveur back

```bash
cd Azul-game-back
npm run dev
```

Le serveur démarre sur **http://localhost:3001**

> `npm run dev` utilise `node --watch` pour recharger automatiquement à chaque modification.  
> En production, utiliser `npm start` (`node server.js`).

### Terminal 2 — Application front

```bash
cd Azul-game-front
npm run dev
```

L'application est accessible sur **http://localhost:5173**

---

## Jouer à deux sur la même machine

1. Lancer le back et le front comme indiqué ci-dessus
2. Ouvrir **deux onglets** dans le navigateur sur `http://localhost:5173`
3. Dans chaque onglet : entrer un pseudo différent, créer ou rejoindre la même room
4. La partie démarre automatiquement quand tous les joueurs ont rejoint

---

## Pages disponibles

| Route | Description |
|-------|-------------|
| `/` | Page d'accueil |
| `/lobby` | Liste des parties, créer / rejoindre une room |
| `/rules` | Règles du jeu |
| `/game` | Plateau de jeu en temps réel |

---

## Fonctionnalités temps réel (WebSocket)

| Événement (client → serveur) | Description |
|-----------------------------|-------------|
| `create_room` | Créer une nouvelle partie |
| `join_room` | Rejoindre une partie existante |
| `join_as_spectator` | Rejoindre en tant que spectateur |
| `rejoin_room` | Se reconnecter après déconnexion |
| `leave_room` | Quitter (slot gardé 60s, reconnexion possible) |
| `pick_from_factory` | Piocher des pierres depuis une fabrique |
| `pick_from_center` | Piocher depuis le centre |
| `place_stones` | Poser des pierres sur une ligne |
| `discard_to_floor` | Défausser en pénalité |
| `request_rematch` | Voter pour une revanche |

| Événement (serveur → client) | Description |
|-----------------------------|-------------|
| `game_update` | Nouvel état complet du jeu |
| `room_list` | Liste des rooms disponibles |
| `opponent_disconnected` | Un joueur s'est déconnecté |
| `opponent_reconnected` | Un joueur s'est reconnecté |
| `disconnect_countdown` | Compte à rebours avant forfait (60s) |
| `force_game_over` | Fin de partie par forfait ou annulation |
| `rematch_votes` | Nombre de votes revanche en cours |

---

## Reconnexion automatique

Si un joueur ferme son onglet ou perd sa connexion **pendant une partie** :
- Son slot est conservé pendant **60 secondes**
- Les autres joueurs voient un compte à rebours
- Si le joueur revient avant la fin, il est **reconnecté automatiquement** et reprend sa place
- Si le délai expire, l'adversaire remporte la partie par forfait

Cette logique s'applique aussi au bouton "Quitter" — quitter pendant une partie ne supprime pas le slot immédiatement.

---

## Règles du jeu Azul (résumé)

1. **Piocher** : à ton tour, prends toutes les pierres d'une même couleur depuis une fabrique ou le centre
2. **Placer** : dépose-les sur une ligne de ton plateau (une seule couleur par ligne)
3. **Mur** : en fin de manche, chaque ligne complète transfère une pierre sur le mur et rapporte des points
4. **Pénalités** : les pierres en excès vont sur la ligne de pénalité (−1 à −3 par case)
5. **Fin de partie** : quand un joueur complète une rangée horizontale de son mur
6. **Bonus** : +2 par ligne complète, +7 par colonne complète, +10 par couleur complète

---

## Scripts disponibles

### Back (`Azul-game-back`)

| Commande | Description |
|----------|-------------|
| `npm start` | Démarrer le serveur (production) |
| `npm run dev` | Démarrer avec rechargement automatique |

### Front (`Azul-game-front`)

| Commande | Description |
|----------|-------------|
| `npm run dev` | Démarrer en mode développement |
| `npm run build` | Compiler pour la production |
| `npm run preview` | Prévisualiser le build de production |
| `npm run lint` | Vérifier le code avec ESLint |

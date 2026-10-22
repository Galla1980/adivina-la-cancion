# Adivina la Canción

Juego local estilo *guesstheaudio*: pegas la URL de una playlist de YouTube o de Spotify, el orden
se mezcla al azar y tienes que adivinar cada canción escuchando fragmentos cada vez más largos.

## Cómo jugar

1. Haz doble clic en `iniciar.bat` (o ejecuta `node server.js`).
2. Se abre el navegador en `http://localhost:4321`.
3. Pega el enlace de una playlist, por ejemplo:
   - YouTube: `https://www.youtube.com/playlist?list=PLxxxxxxxxxxxxxxxx`
   - Spotify: `https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M`
4. Pulsa **Comenzar a jugar** y escribe el título de cada canción.

## Reglas

- Cada canción suena desde un punto aleatorio, empezando con un fragmento de 1 segundo.
- Cada fallo alarga el fragmento (hasta 5 intentos).
- Los títulos que ya has probado en esa canción aparecen tachados debajo del campo.
  Si repites uno, el juego te avisa y no gasta intento (se ignoran mayúsculas y tildes).
- El botón **Más tiempo** salta tu oportunidad de adivinar y alarga el fragmento
  (baja los puntos en juego).
- Puntos: 100 / 75 / 55 / 35 / 20 según el intento en que aciertes.
- Al escribir, el juego autocompleta con títulos de **toda la playlist** (incluidas las canciones
  que no están en la partida). Se puede desactivar en las opciones.
- La pista cuesta 15 puntos; saltar la canción deja 0 puntos.
- Si YouTube mete un anuncio, el juego lo detecta, no gasta tu intento y repite el
  fragmento cuando termina. Puedes pulsar «Saltar anuncio» (el vídeo se ve borroso).
- El audio sale del reproductor de YouTube o de los adelantos de Spotify: necesitas internet.
- Las playlists deben ser públicas o “no listadas”. Los vídeos que no permiten
  insertarse se saltan automáticamente.

### Notas sobre Spotify

- Se usan los **adelantos de 30 segundos** que Spotify publica para cada canción (sin cuenta,
  sin Premium y sin anuncios). El botón «Escuchar adelanto» reproduce esos 30 s.
- Las canciones sin adelanto disponible se omiten.
- El listado que expone la página de Spotify ronda las 50 canciones; si tu playlist es más
  larga, se usarán las primeras.

## Detalles técnicos

- `server.js`: servidor HTTP sin dependencias (solo módulos de Node).
- `public/`: interfaz (HTML, CSS y JavaScript sin frameworks).
- `/api/metadata`: proxy de los datos públicos (título y artista) de cada vídeo,
  para que el título no aparezca en el reproductor durante la partida.
- `/api/spotify/playlist?id=…`: lee la página pública de Spotify y devuelve las canciones
  con su adelanto de audio (caché de 10 minutos).
- El orden de las canciones se baraja en el navegador cada partida.

Para cambiar el puerto: `set PORT=5000 && node server.js`.
Para que no se abra el navegador solo: `node server.js --no-open`.

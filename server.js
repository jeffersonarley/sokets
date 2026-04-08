const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// --- MONGODB ---
mongoose.connect('mongodb://127.0.0.1:27017/proyecto_encuestas')
    .then(() => console.log("✅ Conectado a MongoDB"))
    .catch(err => console.error("❌ Error:", err));

const EncuestaSchema = new mongoose.Schema({
    salaId: String,
    pregunta: String,
    opciones: Object,
    votosRegistrados: [String]
});

const Encuesta = mongoose.model('Encuesta', EncuestaSchema);

// --- JUEGOS ---
const juegosActivos = {};

const getConteo = (salaId) => {
    return io.sockets.adapter.rooms.get(salaId)?.size || 0;
};

io.on('connection', (socket) => {
    console.log('🟢 Conectado:', socket.id);

    // --- UNIRSE A SALA ---
    socket.on('unirse:sala', async (salaId) => {

        // SALIR DE TODAS LAS SALAS ANTES
        socket.rooms.forEach(room => {
            if (room !== socket.id) {
                socket.leave(room);
            }
        });

        socket.join(salaId);

        // Inicializar juego si no existe
        if (!juegosActivos[salaId]) {
            juegosActivos[salaId] = [];
        }

        // Buscar o crear encuesta
        let encuesta = await Encuesta.findOne({ salaId });

        if (!encuesta) {
            encuesta = new Encuesta({
                salaId,
                pregunta: '¿Cuál es tu lenguaje de programación favorito?',
                opciones: {
                    'JavaScript': 0,
                    'Python': 0,
                    'Java': 0,
                    'C#': 0,
                    'PHP': 0
                },
                votosRegistrados: []
            });
            await encuesta.save();
        }

        socket.emit('encuesta:estado', encuesta);
        io.to(salaId).emit('usuarios:conteo', getConteo(salaId));
    });

    // --- VOTAR ---
    socket.on('encuesta:votar', async ({ salaId, opcion }) => {
        const encuesta = await Encuesta.findOne({ salaId });

        if (encuesta.votosRegistrados.includes(socket.id)) {
            return socket.emit('encuesta:error', 'Ya votaste!');
        }

        if (encuesta.opciones[opcion] !== undefined) {
            encuesta.opciones[opcion]++;
            encuesta.votosRegistrados.push(socket.id);

            encuesta.markModified('opciones');
            await encuesta.save();

            io.to(salaId).emit('encuesta:resultado', encuesta);
        }
    });

    // --- CHAT ---
    socket.on('chat:enviar', (data) => {
        io.to(data.salaId).emit('chat:nuevo_mensaje', {
            usuario: data.usuario,
            texto: data.mensaje,
            hora: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });
    });

    // --- JUEGO ---
    socket.on('juego:jugada', ({ salaId, jugada, usuario }) => {

        if (!juegosActivos[salaId]) {
            juegosActivos[salaId] = [];
        }

        // Limitar a 2 jugadores
        if (juegosActivos[salaId].length >= 2) {
            return socket.emit('juego:esperando', 'Partida en curso...');
        }

        juegosActivos[salaId].push({ id: socket.id, usuario, jugada });

        if (juegosActivos[salaId].length === 2) {
            const [p1, p2] = juegosActivos[salaId];
            let ganador = "";

            if (p1.jugada === p2.jugada) {
                ganador = "¡Empate!";
            } else if (
                (p1.jugada === '🪨' && p2.jugada === '✂️') ||
                (p1.jugada === '✂️' && p2.jugada === '📄') ||
                (p1.jugada === '📄' && p2.jugada === '🪨')
            ) {
                ganador = `🏆 Ganó ${p1.usuario}`;
            } else {
                ganador = `🏆 Ganó ${p2.usuario}`;
            }

            io.to(salaId).emit('juego:finalizado', {
                detalle: `${p1.usuario}: ${p1.jugada} vs ${p2.usuario}: ${p2.jugada}`,
                resultado: ganador
            });

            juegosActivos[salaId] = [];
        } else {
            socket.to(salaId).emit('juego:esperando', 'Esperando segundo jugador...');
        }
    });

    // --- DESCONECTAR ---
    socket.on('disconnecting', () => {
        socket.rooms.forEach(room => {
            if (room !== socket.id) {
                setTimeout(() => {
                    io.to(room).emit('usuarios:conteo', getConteo(room));
                }, 100);
            }
        });
    });

    socket.on('disconnect', () => {
        console.log('🔴 Desconectado:', socket.id);
    });
});

server.listen(3002, () => console.log('🔥 http://localhost:3002'));
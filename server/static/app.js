const form = document.getElementById('start-form');
const startButton = document.getElementById('start');
const stopButton = document.getElementById('stop');
const status = document.getElementById('status');
const turn = document.getElementById('turn');
const primaryLabel = document.getElementById('primary-label');
const primaryMove = document.getElementById('primary-move');
const responseLabel = document.getElementById('response-label');
const responseMove = document.getElementById('response-move');
const image = document.getElementById('analysis-image');
const imagePlaceholder = document.getElementById('image-placeholder');
const playerOnlyToggle = document.getElementById('player-only');
const primaryCard = document.querySelector('.move-card.primary');
const responseCard = document.querySelector('.move-card.response');
const bestLegend = document.getElementById('best-legend');
const responseLegendGroup = document.getElementById('response-legend-group');
const resultPanel = document.querySelector('.panel.result');
const legend = document.querySelector('.legend');

let sessionId = null;
let eventSource = null;
let latestAnalysis = null;

function setStatus(message, kind = 'working') {
    status.textContent = message;
    status.dataset.kind = kind;
}

function renderAnalysis(data) {
    latestAnalysis = data;
    const playerOnly = playerOnlyToggle.checked;
    const waitingForPlayer = playerOnly && data.turn === 'opponent';
    const side = data.sideToMove[0].toUpperCase() + data.sideToMove.slice(1);
    turn.textContent = waitingForPlayer
        ? `${side} to move — waiting for your opponent`
        : data.turn === 'player'
        ? `${side} to move — it is your turn`
        : `${side} to move — it is your opponent's turn`;
    primaryLabel.textContent = data.primaryLabel;
    primaryMove.textContent = data.primaryMove;
    responseLabel.textContent = data.responseLabel;
    responseMove.textContent = data.responseMove;
    primaryCard.hidden = waitingForPlayer || (playerOnly && data.primaryMoveOwner !== 'player');
    responseCard.hidden = playerOnly;
    resultPanel.classList.toggle('player-only', playerOnly);
    if (waitingForPlayer) {
        image.removeAttribute('src');
        image.hidden = true;
        imagePlaceholder.textContent = 'Waiting for your opponent to move…';
        imagePlaceholder.hidden = false;
    } else {
        image.src = playerOnly ? data.playerImageUrl : data.imageUrl;
        image.hidden = false;
        imagePlaceholder.hidden = true;
    }
    bestLegend.textContent = playerOnly ? 'Your move' : 'Current best move';
    responseLegendGroup.hidden = playerOnly;
    legend.hidden = waitingForPlayer;
    setStatus(`Monitoring game ${data.gameId}`, 'connected');
}

playerOnlyToggle.addEventListener('change', () => {
    if (latestAnalysis) renderAnalysis(latestAnalysis);
});

function onEvent(event) {
    const data = JSON.parse(event.data);
    console.debug('[Mephisto SSE]', event.type, data);
    if (event.type === 'analysis') {
        renderAnalysis(data);
    } else if (event.type === 'analysis-error') {
        setStatus(`${data.message}${data.retrying ? '\nRetrying automatically…' : ''}`, 'error');
    } else {
        setStatus(data.message || event.type, event.type);
    }
}

function connectEvents(eventsUrl) {
    eventSource = new EventSource(eventsUrl);
    ['connecting', 'monitoring', 'analysis', 'reconnecting', 'analysis-error', 'stopped'].forEach(type => {
        eventSource.addEventListener(type, onEvent);
    });
    eventSource.onerror = () => {
        if (sessionId) setStatus('Event stream interrupted; reconnecting…', 'error');
    };
}

form.addEventListener('submit', async event => {
    event.preventDefault();
    if (sessionId) return;
    startButton.disabled = true;
    setStatus('Starting monitor…');
    try {
        const response = await fetch('/api/sessions', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                gameId: document.getElementById('game-id').value,
                color: new FormData(form).get('color'),
            }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to start monitoring');
        sessionId = data.sessionId;
        stopButton.disabled = false;
        connectEvents(data.eventsUrl);
    } catch (error) {
        startButton.disabled = false;
        setStatus(error.message, 'error');
    }
});

stopButton.addEventListener('click', async () => {
    const stoppingSession = sessionId;
    sessionId = null;
    eventSource?.close();
    eventSource = null;
    stopButton.disabled = true;
    startButton.disabled = false;
    setStatus('Stopping…');
    try {
        await fetch(`/api/sessions/${stoppingSession}`, {method: 'DELETE'});
        setStatus('Monitoring stopped', 'idle');
    } catch (error) {
        setStatus(error.message, 'error');
    }
});

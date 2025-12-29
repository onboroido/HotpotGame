import { useState, useEffect } from 'react'
import './App.css'
import { db } from './firebase'; 
import { ref, onValue, set, update, push, onDisconnect, serverTimestamp } from "firebase/database";

const CARD_TYPES = [
  { id: 1, name: '人参', category: '野菜', color: '#e67e22', icon: '🥕' },
  { id: 2, name: '玉ねぎ', category: '野菜', color: '#e67e22', icon: '🧅' },
  { id: 3, name: 'ジャガイモ', category: '野菜', color: '#e67e22', icon: '🥔' },
  { id: 4, name: '肉', category: '肉類', color: '#c0392b', icon: '🥩' },
  { id: 5, name: '鶏肉', category: '肉類', color: '#c0392b', icon: '🍗' },
  { id: 6, name: 'ソーセージ', category: '肉類', color: '#c0392b', icon: '🌭' },
  { id: 7, name: 'エビ', category: '魚介', color: '#2980b9', icon: '🦐' },
  { id: 8, name: 'カニ', category: '魚介', color: '#2980b9', icon: '🦀' },
  { id: 9, name: '魚', category: '魚介', color: '#2980b9', icon: '🐟' },
  { id: 10, name: '白菜', category: '葉物', color: '#27ae60', icon: '🥬' },
  { id: 11, name: 'ネギ', category: '葉物', color: '#27ae60', icon: '🎋' },
  { id: 12, name: 'ニラ', category: '葉物', color: '#27ae60', icon: '🌿' },
];

function App() {
  const [gameMode, setGameMode] = useState(null);
  const [roomId, setRoomId] = useState(() => new URLSearchParams(window.location.search).get('room'));
  const [myId, setMyId] = useState(null);
  const [players, setPlayers] = useState({});
  const [gameStatus, setGameStatus] = useState("waiting");
  const [playerName, setPlayerName] = useState("");
  const [isJoined, setIsJoined] = useState(false);
  const [deck, setDeck] = useState([]);
  const [slots, setSlots] = useState([null, null, null, null]);
  const [turn, setTurn] = useState(0);
  const [round, setRound] = useState(1); // ラウンド管理
  const [gameLog, setGameLog] = useState("準備中...");
  const [hasDrawn, setHasDrawn] = useState(false);
  const [lastWinDetails, setLastWinDetails] = useState({ total: 0, breakdown: [] });
  const [hand, setHand] = useState([]); 
  const [cpuHands, setCpuHands] = useState([[], [], []]);
  const [totalScore, setTotalScore] = useState(0); // 累積スコア

  useEffect(() => {
    if (gameMode !== "online") return;
    let currentRoomId = roomId || Math.random().toString(36).substring(2, 7);
    if (!roomId) {
      setRoomId(currentRoomId);
      window.history.pushState({}, '', `?room=${currentRoomId}`);
    }
    const roomRef = ref(db, `rooms/${currentRoomId}`);
    return onValue(roomRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setPlayers(data.players || {});
        setGameStatus(data.status || "waiting");
        setDeck(data.deck || []);
        setSlots(data.slots || [null, null, null, null]);
        setTurn(data.turn || 0);
        setRound(data.round || 1);
        setGameLog(data.log || "");
        setHasDrawn(data.hasDrawn || false);
        if (data.lastWinDetails) setLastWinDetails(data.lastWinDetails);
      }
    });
  }, [gameMode, roomId]);

  const sortHand = (h) => [...(h || [])].sort((a, b) => a.id - b.id);

  const getProcessedHand = (currentHand) => {
    if (!currentHand || currentHand.length === 0) return [];
    let p = currentHand.map(c => ({ ...c, isCompleted: false }));
    const counts = {};
    p.forEach(c => { counts[c.id] = (counts[c.id] || 0) + 1; });
    p = p.map(c => counts[c.id] >= 3 ? { ...c, isCompleted: true } : c);
    ['野菜', '肉類', '魚介', '葉物'].forEach(cat => {
      const catCards = p.filter(c => c.category === cat && !c.isCompleted);
      const uniqueIds = [...new Set(catCards.map(c => c.id))];
      if (uniqueIds.length >= 3) {
        const usedIds = uniqueIds.slice(0, 3);
        p = p.map(c => (c.category === cat && usedIds.includes(c.id) && !c.isCompleted) ? { ...c, isCompleted: true } : c);
      }
    });
    return p;
  };

  const checkWin = (currentHand) => {
    const processed = getProcessedHand(currentHand);
    return processed.filter(c => c.isCompleted).length >= 9;
  };

  const calculateScore = (finalHand, isWinner) => {
    let total = isWinner ? 40 : 0;
    let breakdown = isWinner ? ["勝利ボーナス: 40点"] : [];
    const processed = getProcessedHand(finalHand);
    const checkedIds = new Set();
    const idCount = {}; processed.forEach(c => idCount[c.id] = (idCount[c.id] || 0) + 1);
    Object.keys(idCount).forEach(id => {
      if (idCount[id] >= 3) {
        total += 30;
        const name = CARD_TYPES.find(t => t.id === parseInt(id)).name;
        breakdown.push(`${name}同種セット: 30点`);
        checkedIds.add(parseInt(id));
      }
    });
    ['野菜', '肉類', '魚介', '葉物'].forEach(cat => {
      const catCards = processed.filter(c => c.category === cat && !checkedIds.has(c.id));
      const uIds = [...new Set(catCards.map(c => c.id))];
      if (uIds.length >= 3) {
        total += 15;
        breakdown.push(`${cat}カテゴリーセット: 15点`);
      }
    });
    return { total, breakdown };
  };

  // 終了処理の共通化
  const finishRound = (winningHand, isPlayerWinner, winnerName) => {
    const scoreDetails = calculateScore(winningHand, isPlayerWinner);
    if (isPlayerWinner) setTotalScore(prev => prev + scoreDetails.total);

    if (gameMode === "cpu") {
      setGameStatus("finished");
      setLastWinDetails(scoreDetails);
      setGameLog(`${winnerName}の「いただきます！」`);
    } else {
      update(ref(db, `rooms/${roomId}`), { 
        status: "finished", 
        lastWinDetails: scoreDetails, 
        log: `${winnerName}の「いただきます！」` 
      });
    }
  };

  useEffect(() => {
    if (gameMode === "cpu" && gameStatus === "playing" && turn !== 0) {
      const timer = setTimeout(() => {
        let currentCpuIdx = turn - 1; 
        let h = [...cpuHands[currentCpuIdx]];
        let newDeck = [...deck];
        let newSlots = [...slots];
        let picked;
        const prevTurnIdx = (turn === 0) ? 3 : turn - 1;
        if (newSlots[prevTurnIdx] && Math.random() > 0.8) {
          picked = newSlots[prevTurnIdx];
          newSlots[prevTurnIdx] = null;
        } else if (newDeck.length > 0) {
          picked = newDeck.pop();
        }
        if (!picked) return;
        h.push(picked);
        if (checkWin(h)) {
          setTimeout(() => finishRound(h, false, `CPU ${turn}`), 2000);
        } else {
          const dIdx = Math.floor(Math.random() * h.length);
          const discarded = h.splice(dIdx, 1)[0];
          newSlots[turn] = discarded;
          setCpuHands(prev => { let n = [...prev]; n[currentCpuIdx] = h; return n; });
          setSlots(newSlots);
          setDeck(newDeck);
          setGameLog(`CPU ${turn}が捨てました`);
          setTurn((turn + 1) % 4);
        }
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [turn, gameStatus, gameMode, cpuHands, deck, slots]);

  const startAction = (resetGame = false) => {
    const fullDeck = [];
    CARD_TYPES.forEach(type => {
      for(let i=0; i<5; i++) fullDeck.push({...type, instanceId: Math.random()});
    });
    fullDeck.sort(() => Math.random() - 0.5);

    const nextRound = resetGame ? 1 : round + (gameStatus === "finished" ? 1 : 0);
    if (resetGame) setTotalScore(0);

    if (gameMode === "cpu") {
      setRound(nextRound);
      setHand(sortHand(fullDeck.splice(0, 8)));
      setCpuHands([fullDeck.splice(0, 8), fullDeck.splice(0, 8), fullDeck.splice(0, 8)]);
      setDeck(fullDeck); setSlots([null,null,null,null]);
      setGameStatus("playing"); setTurn(0); setHasDrawn(false); 
      setGameLog(`第${nextRound}ラウンド開始！`);
    } else {
      const playerIds = Object.keys(players);
      const updates = {};
      playerIds.forEach(id => { updates[`players/${id}/hand`] = sortHand(fullDeck.splice(0, 8)); });
      updates['round'] = nextRound;
      updates['status'] = "playing";
      updates['deck'] = fullDeck;
      updates['slots'] = [null, null, null, null];
      updates['turn'] = 0;
      updates['hasDrawn'] = false;
      updates['log'] = `第${nextRound}ラウンド開始！`;
      update(ref(db, `rooms/${roomId}`), updates);
    }
  };

  const drawAction = () => {
    const pIds = Object.keys(players);
    const mIdx = gameMode === "online" ? pIds.indexOf(myId) : 0;
    if (turn !== mIdx || hasDrawn || gameStatus !== "playing") return;
    let newDeck = [...deck];
    if (newDeck.length === 0) return;
    const picked = newDeck.pop();
    const curH = gameMode === "online" ? players[myId].hand : hand;
    const newHand = sortHand([...(curH || []), picked]);
    if (gameMode === "cpu") {
      setHand(newHand); setDeck(newDeck); setHasDrawn(true);
      if (checkWin(newHand)) setTimeout(() => finishRound(newHand, true, "あなた"), 2000);
    } else {
      update(ref(db, `rooms/${roomId}`), { deck: newDeck, [`players/${myId}/hand`]: newHand, hasDrawn: true });
      if (checkWin(newHand)) setTimeout(() => finishRound(newHand, true, playerName), 2000);
    }
  };

  const discardAction = (idx) => {
    const pIds = Object.keys(players);
    const mIdx = gameMode === "online" ? pIds.indexOf(myId) : 0;
    if (turn !== mIdx || !hasDrawn || gameStatus !== "playing") return;
    const curH = gameMode === "online" ? players[myId].hand : hand;
    const newHand = [...(curH || [])];
    const discarded = newHand.splice(idx, 1)[0];
    if (gameMode === "cpu") {
      const newSlots = [...slots]; newSlots[0] = discarded;
      setHand(sortHand(newHand)); setSlots(newSlots); setHasDrawn(false); setTurn(1);
    } else {
      const nextTurn = (turn + 1) % pIds.length;
      update(ref(db, `rooms/${roomId}`), { [`players/${myId}/hand`]: sortHand(newHand), [`slots/${mIdx}`]: discarded, turn: nextTurn, hasDrawn: false });
    }
  };

  const pickFromSlotAction = (idx) => {
    const pIds = Object.keys(players);
    const mIdx = gameMode === "online" ? pIds.indexOf(myId) : 0;
    if (turn !== mIdx || hasDrawn || !slots[idx] || gameStatus !== "playing") return;
    const picked = slots[idx];
    const newSlots = [...slots]; newSlots[idx] = null;
    const curH = gameMode === "online" ? players[myId].hand : hand;
    const newHand = sortHand([...(curH || []), picked]);
    if (gameMode === "cpu") {
      setHand(newHand); setSlots(newSlots); setHasDrawn(true);
      if (checkWin(newHand)) setTimeout(() => finishRound(newHand, true, "あなた"), 2000);
    } else {
      update(ref(db, `rooms/${roomId}`), { slots: newSlots, [`players/${myId}/hand`]: newHand, hasDrawn: true });
      if (checkWin(newHand)) setTimeout(() => finishRound(newHand, true, playerName), 2000);
    }
  };

  const CardDisplay = ({ card, onClick, className }) => {
    if (!card) return null;
    const fontSize = card.name.length > 5 ? '0.5rem' : card.name.length > 3 ? '0.6rem' : '0.7rem';
    return (
      <div className={`card ${className || ""}`} style={{ '--card-color': card.color }} onClick={onClick}>
        <div className="card-inner">
          <div className="card-category-tag" style={{backgroundColor: card.color}}>{card.category}</div>
          <div className="card-icon emoji-wrapper">{card.icon}</div>
          <div className="card-name" style={{ fontSize: fontSize }}>{card.name}</div>
        </div>
        {card.isCompleted && <div className="set-label">SET!</div>}
      </div>
    );
  };

  if (!gameMode) {
    return (
      <div className="game-container full-height">
        <div className="start-screen main-menu">
          <h1 className="title-large">🍲 Hotpot Game</h1>
          <div className="menu-buttons">
            <button onClick={() => setGameMode("cpu")} className="mega-button">CPUと対戦</button>
            <button onClick={() => setGameMode("online")} className="mega-button">オンライン対戦</button>
          </div>
        </div>
      </div>
    );
  }

  if (gameMode === "online" && !isJoined) {
    return (
      <div className="game-container full-height">
        <div className="start-screen">
          <h2 className="section-title">プレイヤー登録</h2>
          <input type="text" value={playerName} onChange={(e) => setPlayerName(e.target.value)} className="name-input-large" placeholder="名前を入力" />
          <button onClick={() => {
            if (!playerName.trim()) return alert("名前を入力してください");
            const playersRef = ref(db, `rooms/${roomId}/players`);
            const newPlayerRef = push(playersRef);
            setMyId(newPlayerRef.key);
            set(newPlayerRef, { name: playerName, joinedAt: serverTimestamp(), hand: [], score: 0 });
            onDisconnect(newPlayerRef).remove();
            setIsJoined(true);
          }} className="mega-button">入室する</button>
        </div>
      </div>
    );
  }

  const pIds = Object.keys(players);
  const mIdx = gameMode === "online" ? pIds.indexOf(myId) : 0;
  const curHand = gameMode === "online" ? (players[myId]?.hand || []) : hand;

  return (
    <div className="game-container pc-optimized">
      <div className="compact-score-badge">
        <div className="score-row"><span className="score-label">ROUND {round}/3</span><span className="score-value">{gameMode === "online" ? (players[myId]?.score || 0) : totalScore}<small>pt</small></span></div>
        <div className="mini-log-text">{gameLog}</div>
      </div>

      <div className="top-bar">
        <span>{gameMode === "online" ? `Room: ${roomId}` : "Solo Play"}</span>
      </div>
      
      {gameStatus === "waiting" ? (
        <div className="start-screen centered">
          <button onClick={() => startAction(true)} className="mega-button">ゲーム開始</button>
        </div>
      ) : (
        <div className="playing-field">
          <div className="table-row">
            <div className={`player-info-box ${(turn === (mIdx + 2) % 4) ? 'active' : ''}`}>
              <div className="p-name-tag">{gameMode === "online" ? (players[pIds[(mIdx+2)%4]]?.name || "P3") : "CPU 2"}</div>
            </div>
          </div>

          <div className="center-board-wrapper">
             <div className={`player-info-box side left-side ${(turn === (mIdx + 1) % 4) ? 'active' : ''}`}>
               <div className="p-name-tag vertical">{gameMode === "online" ? (players[pIds[(mIdx+1)%4]]?.name || "P2") : "CPU 1"}</div>
             </div>
             <div className="cross-grid">
                <div className="grid-cell empty"></div>
                <div className="grid-cell slot top-slot" onClick={() => pickFromSlotAction((mIdx + 2) % 4)}><CardDisplay card={slots[(mIdx + 2) % 4]} /></div>
                <div className="grid-cell empty"></div>
                <div className="grid-cell slot left-slot" onClick={() => pickFromSlotAction((mIdx + 1) % 4)}><CardDisplay card={slots[(mIdx + 1) % 4]} /></div>
                <div className={`grid-cell deck-cell ${(turn === mIdx && !hasDrawn) ? 'can-draw' : ''}`} onClick={drawAction}><div className="deck-back-design"></div></div>
                <div className="grid-cell slot right-slot" onClick={() => pickFromSlotAction((mIdx + 3) % 4)}><CardDisplay card={slots[(mIdx + 3) % 4]} /></div>
                <div className="grid-cell empty"></div>
                <div className="grid-cell slot bottom-slot" onClick={() => pickFromSlotAction(mIdx)}><CardDisplay card={slots[mIdx]} /></div>
                <div className="grid-cell empty"></div>
             </div>
             <div className={`player-info-box side right-side ${(turn === (mIdx + 3) % 4) ? 'active' : ''}`}>
               <div className="p-name-tag vertical">{gameMode === "online" ? (players[pIds[(mIdx+3)%4]]?.name || "P4") : "CPU 3"}</div>
             </div>
          </div>

          <div className="table-row bottom-player-row">
            <div className={`my-hand-area ${turn === mIdx ? 'active' : ''}`}>
               <div className="my-hand-container">
                  {getProcessedHand(curHand).map((c, i) => (
                    <CardDisplay key={i} card={c} className={`${(turn === mIdx && hasDrawn) ? 'discardable' : ''} ${c.isCompleted ? 'completed' : ''}`} onClick={() => discardAction(i)} />
                  ))}
                </div>
            </div>
          </div>
        </div>
      )}

      {gameStatus === "finished" && (
        <div className="win-overlay-full">
          <div className="win-card">
            <h2 className="win-title">いただきます！</h2>
            <p>第{round}ラウンド終了</p>
            <div className="total-score-big">{lastWinDetails.total} <small>pt</small></div>
            
            {round < 3 ? (
              <button onClick={() => startAction(false)} className="mega-button">次のラウンドへ</button>
            ) : (
              <div className="final-result">
                <h3>最終結果</h3>
                <button onClick={() => startAction(true)} className="mega-button">もう一杯！（最初から）</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
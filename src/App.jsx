import { useState, useEffect, useCallback, useRef } from 'react'
import './App.css'
import { db } from './firebase'; 
import { ref, onValue, set, update, push, onDisconnect, runTransaction, get } from "firebase/database";

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
  // ルームIDの初期化を強化：URLにあればそれを最優先、なければnull
  const [roomId, setRoomId] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('room') || null;
  });
  
  const [gameMode, setGameMode] = useState(roomId ? "online" : null); // IDがある状態で開いたらオンラインモードへ
  const [myId, setMyId] = useState(null);
  const [players, setPlayers] = useState({});
  const [gameStatus, setGameStatus] = useState("waiting");
  const [playerName, setPlayerName] = useState("");
  const [isJoined, setIsJoined] = useState(false);
  const [deck, setDeck] = useState([]);
  const [slots, setSlots] = useState([null, null, null, null]);
  const [turn, setTurn] = useState(0);
  const [round, setRound] = useState(1);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [showFinalResult, setShowFinalResult] = useState(false);
  const [lastRoundHands, setLastRoundHands] = useState(null);

  const isProcessingRef = useRef(false);

  const getInviteUrl = () => `${window.location.origin}${window.location.pathname}?room=${roomId}`;
  const sortHand = (h) => [...(h || [])].sort((a, b) => a.id - b.id);

  // --- 判定・計算ロジック ---
  const getProcessedHand = (currentHand) => {
    if (!currentHand || currentHand.length === 0) return [];
    let p = currentHand.map(c => ({ ...c, isCompleted: false }));
    const counts = {};
    p.forEach(c => { counts[c.id] = (counts[c.id] || 0) + 1; });
    p = p.map(c => counts[c.id] >= 3 ? { ...c, isCompleted: true } : c);
    ['野菜', '肉類', '魚介', '葉物'].forEach(cat => {
      let available = p.filter(c => c.category === cat && !c.isCompleted);
      const uniqueIds = [...new Set(available.map(c => c.id))];
      if (uniqueIds.length >= 3) {
        const targetIds = uniqueIds.slice(0, 3);
        p = p.map(c => (c.category === cat && targetIds.includes(c.id) && !c.isCompleted) ? { ...c, isCompleted: true } : c);
      }
    });
    return p;
  };

  const checkWin = (currentHand) => getProcessedHand(currentHand).filter(c => c.isCompleted).length >= 9;

  const calculateScore = (finalHand, isWinner) => {
    let score = isWinner ? 25 : 0; 
    let p = finalHand.map(c => ({ ...c, isCompleted: false }));
    const counts = {};
    p.forEach(c => { counts[c.id] = (counts[c.id] || 0) + 1; });
    Object.keys(counts).forEach(id => {
      if (counts[id] >= 3) {
        score += 25;
        let cCount = 0;
        p = p.map(c => {
          if (c.id === parseInt(id) && cCount < 3) { cCount++; return { ...c, isCompleted: true }; }
          return c;
        });
      }
    });
    ['野菜', '肉類', '魚介', '葉物'].forEach(cat => {
      let available = p.filter(c => c.category === cat && !c.isCompleted);
      const uniqueIds = [...new Set(available.map(c => c.id))];
      while (uniqueIds.length >= 3) {
        score += 15;
        const targetIds = uniqueIds.splice(0, 3);
        p = p.map(c => {
          if (c.category === cat && targetIds.includes(c.id) && !c.isCompleted) return { ...c, isCompleted: true };
          return c;
        });
      }
    });
    return { total: score };
  };

  const finalizeGameScores = (winnerId = null, winningHand = null) => {
    if (gameMode === "online") {
      const roomRef = ref(db, `rooms/${roomId}`);
      runTransaction(roomRef, (currentData) => {
        if (!currentData || currentData.status === "finished") return;
        const pIds = Object.keys(currentData.players);
        const roundHands = {};
        pIds.forEach(id => {
          const isWinner = (id === winnerId);
          const targetHand = isWinner ? winningHand : (currentData.players[id].hand || []);
          const scoreData = calculateScore(targetHand, isWinner);
          currentData.players[id].score = (currentData.players[id].score || 0) + scoreData.total;
          roundHands[id] = { name: currentData.players[id].name, hand: targetHand, isWinner, roundScore: scoreData.total };
        });
        currentData.status = "finished";
        currentData.lastRoundHands = roundHands;
        return currentData;
      });
    } else {
      const pIds = Object.keys(players);
      const roundHands = {};
      const newPlayers = { ...players };
      pIds.forEach(id => {
        const isWinner = (id === winnerId);
        const targetHand = isWinner ? winningHand : (players[id].hand || []);
        const scoreData = calculateScore(targetHand, isWinner);
        newPlayers[id].score = (newPlayers[id].score || 0) + scoreData.total;
        roundHands[id] = { name: players[id].name, hand: targetHand, isWinner, roundScore: scoreData.total };
      });
      setPlayers(newPlayers);
      setLastRoundHands(roundHands);
      setGameStatus("finished");
    }
  };

  const startAction = useCallback(async (resetGame = false) => {
    setShowFinalResult(false);
    setLastRoundHands(null);
    const fullDeck = [];
    CARD_TYPES.forEach(type => { for(let i=0; i<5; i++) fullDeck.push({...type, instanceId: Math.random()}); });
    fullDeck.sort(() => Math.random() - 0.5);

    if (gameMode === "online") {
      const roomRef = ref(db, `rooms/${roomId}`);
      runTransaction(roomRef, (currentData) => {
        if (!currentData) return;
        const pIds = Object.keys(currentData.players).filter(id => !id.startsWith("cpu_"));
        const newPlayers = {};
        pIds.forEach(id => {
          newPlayers[id] = { ...currentData.players[id], hand: sortHand(fullDeck.splice(0, 8)), score: resetGame ? 0 : (currentData.players[id].score || 0) };
        });
        for (let i = pIds.length; i < 4; i++) {
          const cpuId = `cpu_${i}`;
          newPlayers[cpuId] = { name: `CPU ${i}`, hand: sortHand(fullDeck.splice(0, 8)), score: resetGame ? 0 : (currentData.players[cpuId]?.score || 0), isCpu: true };
        }
        currentData.players = newPlayers;
        currentData.deck = fullDeck;
        currentData.slots = [null, null, null, null];
        currentData.turn = 0;
        currentData.hasDrawn = false;
        currentData.status = "playing";
        currentData.round = resetGame ? 1 : (currentData.round || 1) + 1;
        currentData.lastRoundHands = null;
        return currentData;
      });
    } else {
      const initPlayers = {
        me: { name: "あなた", hand: sortHand(fullDeck.splice(0, 8)), score: resetGame ? 0 : (players.me?.score || 0) },
        cpu_1: { name: "CPU 1", hand: sortHand(fullDeck.splice(0, 8)), score: resetGame ? 0 : (players.cpu_1?.score || 0), isCpu: true },
        cpu_2: { name: "CPU 2", hand: sortHand(fullDeck.splice(0, 8)), score: resetGame ? 0 : (players.cpu_2?.score || 0), isCpu: true },
        cpu_3: { name: "CPU 3", hand: sortHand(fullDeck.splice(0, 8)), score: resetGame ? 0 : (players.cpu_3?.score || 0), isCpu: true },
      };
      setPlayers(initPlayers);
      setDeck(fullDeck);
      setSlots([null, null, null, null]);
      setTurn(0);
      setHasDrawn(false);
      setRound(resetGame ? 1 : round + 1);
      setGameStatus("playing");
    }
  }, [gameMode, roomId, players, round]);

  useEffect(() => {
    if (gameMode !== "online" || !roomId) return;
    const roomRef = ref(db, `rooms/${roomId}`);
    return onValue(roomRef, (s) => {
      const d = s.val();
      if (!d) return;
      setPlayers(d.players || {});
      setGameStatus(d.status || "waiting");
      setDeck(d.deck || []);
      setSlots(d.slots || [null, null, null, null]);
      setTurn(d.turn || 0);
      setRound(d.round || 1);
      setHasDrawn(d.hasDrawn || false);
      setLastRoundHands(d.lastRoundHands || null);
    });
  }, [gameMode, roomId]);

  useEffect(() => {
    if (gameStatus !== "playing" || isProcessingRef.current) return;
    const pIds = Object.keys(players);
    if (pIds.length < 4) return;
    const currentPlayerId = pIds[turn];
    if (!players[currentPlayerId]?.isCpu) return;
    if (gameMode === "online" && myId !== pIds[0]) return;

    const runCpuTurn = async () => {
      isProcessingRef.current = true;
      await new Promise(r => setTimeout(r, 1200));
      if (!hasDrawn) {
        const newDeck = [...deck];
        if (newDeck.length === 0) { finalizeGameScores(null, []); isProcessingRef.current = false; return; }
        const picked = newDeck.pop();
        const cpuHand = sortHand([...(players[currentPlayerId].hand || []), picked]);
        if (checkWin(cpuHand)) { finalizeGameScores(currentPlayerId, cpuHand); }
        else {
          if (gameMode === "online") update(ref(db, `rooms/${roomId}`), { deck: newDeck, [`players/${currentPlayerId}/hand`]: cpuHand, hasDrawn: true });
          else { setDeck(newDeck); setPlayers(p => ({ ...p, [currentPlayerId]: { ...p[currentPlayerId], hand: cpuHand } })); setHasDrawn(true); }
        }
      } else {
        const cpuHand = [...(players[currentPlayerId].hand || [])];
        const discarded = cpuHand.splice(Math.floor(Math.random() * cpuHand.length), 1)[0];
        if (gameMode === "online") update(ref(db, `rooms/${roomId}`), { [`players/${currentPlayerId}/hand`]: sortHand(cpuHand), [`slots/${turn}`]: discarded, turn: (turn + 1) % 4, hasDrawn: false });
        else { setPlayers(p => ({ ...p, [currentPlayerId]: { ...p[currentPlayerId], hand: sortHand(cpuHand) } })); setSlots(s => { const ns = [...s]; ns[turn] = discarded; return ns; }); setTurn((turn + 1) % 4); setHasDrawn(false); }
      }
      isProcessingRef.current = false;
    };
    runCpuTurn();
  }, [turn, hasDrawn, gameStatus, players, deck, gameMode]);

  const drawAction = () => {
    const pIds = Object.keys(players);
    const mId = gameMode === "online" ? myId : "me";
    if (turn !== pIds.indexOf(mId) || hasDrawn) return;
    if (deck.length === 0) return;
    const newDeck = [...deck];
    const picked = newDeck.pop();
    const newHand = sortHand([...(players[mId].hand || []), picked]);
    if (checkWin(newHand)) finalizeGameScores(mId, newHand);
    else {
      if (gameMode === "online") update(ref(db, `rooms/${roomId}`), { deck: newDeck, [`players/${mId}/hand`]: newHand, hasDrawn: true });
      else { setDeck(newDeck); setPlayers(p => ({ ...p, me: { ...p.me, hand: newHand } })); setHasDrawn(true); }
    }
  };

  const discardAction = (idx) => {
    const pIds = Object.keys(players);
    const mId = gameMode === "online" ? myId : "me";
    const mIdx = pIds.indexOf(mId);
    if (turn !== mIdx || !hasDrawn) return;
    const curH = [...(players[mId].hand || [])];
    const discarded = curH.splice(idx, 1)[0];
    if (gameMode === "online") update(ref(db, `rooms/${roomId}`), { [`players/${mId}/hand`]: sortHand(curH), [`slots/${mIdx}`]: discarded, turn: (turn + 1) % 4, hasDrawn: false });
    else { setPlayers(p => ({ ...p, me: { ...p.me, hand: sortHand(curH) } })); setSlots(s => { const ns = [...s]; ns[mIdx] = discarded; return ns; }); setTurn((turn + 1) % 4); setHasDrawn(false); }
  };

  const pickFromSlotAction = (idx) => {
    const pIds = Object.keys(players);
    const mId = gameMode === "online" ? myId : "me";
    const mIdx = pIds.indexOf(mId);
    if (turn !== mIdx || hasDrawn || !slots[idx]) return;
    if (gameMode === "online") {
      runTransaction(ref(db, `rooms/${roomId}`), (d) => {
        if (!d || !d.slots[idx]) return;
        const picked = d.slots[idx]; d.slots[idx] = null;
        const newHand = sortHand([...(d.players[mId].hand || []), picked]);
        if (checkWin(newHand)) { d.players[mId].hand = newHand; setTimeout(() => finalizeGameScores(mId, newHand), 100); }
        else { d.players[mId].hand = newHand; d.hasDrawn = true; }
        return d;
      });
    } else {
      const picked = slots[idx];
      const newHand = sortHand([...(players.me.hand || []), picked]);
      setSlots(s => { const ns = [...s]; ns[idx] = null; return ns; });
      if (checkWin(newHand)) finalizeGameScores("me", newHand);
      else { setPlayers(p => ({ ...p, me: { ...p.me, hand: newHand } })); setHasDrawn(true); }
    }
  };

  const CardDisplay = ({ card, onClick, className }) => (
    card ? (
      <div className={`card ${className || ""}`} style={{ '--card-color': card.color }} onClick={onClick}>
        <div className="card-inner">
          <div className="card-category-tag" style={{backgroundColor: card.color}}>{card.category}</div>
          <div className="card-icon">{card.icon}</div>
          <div className="card-name">{card.name}</div>
          {card.isCompleted && <div className="set-badge">SET</div>}
        </div>
      </div>
    ) : null
  );

  // --- メニュー画面の表示条件修正 ---
  if (!gameMode) return (
    <div className="game-container menu-bg">
      <div className="start-screen main-menu">
        <h1 className="title-large">🍲 Hotpot Game</h1>
        <div className="menu-buttons">
          <button onClick={() => { setGameMode("cpu"); setMyId("me"); }} className="mega-button">一人で練習 (CPU戦)</button>
          <button onClick={() => {
            const r = Math.random().toString(36).substring(2,7);
            setRoomId(r); setGameMode("online");
            window.history.pushState({}, '', `?room=${r}`);
          }} className="mega-button">オンライン対戦（部屋を作る）</button>
        </div>
      </div>
    </div>
  );

  if (gameMode === "online" && !isJoined) return (
    <div className="game-container">
      <div className="start-screen">
        <h2 className="section-title">プレイヤー登録 (Room: {roomId})</h2>
        <input type="text" value={playerName} onChange={(e) => setPlayerName(e.target.value)} className="name-input-large" placeholder="名前を入力" />
        <button onClick={async () => {
          if (!playerName.trim()) return;
          const pRef = push(ref(db, `rooms/${roomId}/players`));
          setMyId(pRef.key);
          await set(pRef, { name: playerName, hand: [], score: 0 });
          onDisconnect(pRef).remove(); setIsJoined(true);
        }} className="mega-button">参加する</button>
      </div>
    </div>
  );

  const pIds = Object.keys(players);
  const mId = gameMode === "online" ? myId : "me";
  const mIdx = pIds.indexOf(mId);
  const curHand = players[mId]?.hand || [];
  const currentRank = pIds.map(id => ({ ...players[id], isMe: id === mId })).sort((a,b)=>b.score-a.score);

  return (
    <div className="game-container">
      <div className="top-ui-bar">
        <div className="round-badge-new">Round {round}/3</div>
        {gameMode === "online" && <div className="invite-link-box" onClick={() => { navigator.clipboard.writeText(getInviteUrl()); alert("コピーしました"); }}>🔗 URLをコピー</div>}
      </div>

      {gameStatus === "waiting" ? (
        <div className="start-screen centered">
          <div className="waiting-card">
            {gameMode === "online" ? (
              <><h2>待機中 ({pIds.length}/4)</h2><div className="p-list">{pIds.map(id => <div key={id} className="p-list-item">{players[id].name}</div>)}</div></>
            ) : (
              <h2>CPU戦の準備ができました</h2>
            )}
            {(gameMode === "cpu" || mIdx === 0) && <button onClick={() => startAction(true)} className="mega-button">ゲーム開始</button>}
          </div>
        </div>
      ) : (
        <div className="playing-wrapper playing-bg">
          <div className="main-area">
            <div className="row top"><div className={`p-box ${(turn === (mIdx+2)%4) ? 'active' : ''}`}>{players[pIds[(mIdx+2)%4]]?.name || "-"}</div></div>
            <div className="row middle">
              <div className="side-container left"><div className={`p-box ${(turn === (mIdx+1)%4) ? 'active' : ''}`}>{players[pIds[(mIdx+1)%4]]?.name || "-"}</div></div>
              <div className="board-center">
                <div className="slots-grid">
                  <div className="slot t" onClick={()=>pickFromSlotAction((mIdx+2)%4)}><CardDisplay card={slots[(mIdx+2)%4]}/></div>
                  <div className="slot l" onClick={()=>pickFromSlotAction((mIdx+1)%4)}><CardDisplay card={slots[(mIdx+1)%4]}/></div>
                  <div className={`deck ${(!hasDrawn && turn===mIdx) ? 'can-draw' : ''}`} onClick={drawAction}>山札</div>
                  <div className="slot r" onClick={()=>pickFromSlotAction((mIdx+3)%4)}><CardDisplay card={slots[(mIdx+3)%4]}/></div>
                  <div className="slot b" onClick={()=>pickFromSlotAction(mIdx)}><CardDisplay card={slots[mIdx]}/></div>
                </div>
              </div>
              <div className="side-container right"><div className={`p-box ${(turn === (mIdx+3)%4) ? 'active' : ''}`}>{players[pIds[(mIdx+3)%4]]?.name || "-"}</div></div>
            </div>
            <div className="row bottom">
              <div className={`hand ${turn === mIdx ? 'my-turn' : ''}`}>
                {getProcessedHand(curHand).map((c, i) => <CardDisplay key={i} card={c} className={hasDrawn && turn===mIdx ? 'active' : ''} onClick={()=>discardAction(i)}/>)}
              </div>
            </div>
          </div>
          <div className="rank-panel">
            <div className="rank-title">RANKING</div>
            <div className="rank-list">{currentRank.map((r, i) => <div key={i} className={`rank-item ${r.isMe?'me':''}`}><span>{i+1}. {r.name}</span><span>{r.score}pt</span></div>)}</div>
          </div>
        </div>
      )}

      {gameStatus === "finished" && !showFinalResult && (
        <div className="win-overlay scrollable">
          <div className="win-card wide">
            <h2 className="win-title">ラウンド終了！</h2>
            <div className="open-hands-container">
              {lastRoundHands && Object.entries(lastRoundHands).map(([id, data]) => (
                <div key={id} className={`open-player-row ${data.isWinner ? 'winner-row' : ''}`}>
                  <div className="open-player-info"><span className="open-player-name">{data.name}</span><span className="open-player-score">+{data.roundScore}pt</span></div>
                  <div className="open-hand-cards">
                    {getProcessedHand(data.hand || []).map((c, i) => (
                      <div key={i} className="mini-card" style={{'--card-color': c.color}}><span>{c.icon}</span>{c.isCompleted && <div className="mini-set-dot"></div>}</div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="win-actions">{(gameMode === "cpu" || mIdx === 0) && (round < 3 ? <button onClick={() => startAction(false)} className="mega-button">次へ</button> : <button onClick={() => setShowFinalResult(true)} className="mega-button primary">最終結果</button>)}</div>
          </div>
        </div>
      )}

      {showFinalResult && (
        <div className="win-overlay final-bg">
          <div className="final-card">
            <h1 className="final-title">🏆 最終結果 🏆</h1>
            <div className="final-rank-list">{currentRank.map((r, i) => (
              <div key={i} className={`final-rank-item rank-${i+1} ${r.isMe?'me':''}`}>
                <div className="rank-num">{i+1}</div>
                <div className="rank-name">{r.name}</div>
                <div className="rank-score">{r.score}pt</div>
              </div>
            ))}</div>
            {(gameMode === "cpu" || mIdx === 0) && <button onClick={() => startAction(true)} className="mega-button restart-btn">もう一杯！ (リスタート)</button>}
            <button onClick={() => { window.location.href = window.location.origin + window.location.pathname; }} className="mega-button quit-btn">タイトルへ</button>
          </div>
        </div>
      )}
    </div>
  );
}
export default App;
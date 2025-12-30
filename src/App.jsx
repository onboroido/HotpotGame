import { useState, useEffect, useCallback, useRef } from 'react'
import './App.css'
import { db } from './firebase'; 
import { ref, onValue, set, update, push, onDisconnect, runTransaction } from "firebase/database";

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
  const [gameMode, setGameMode] = useState(() => new URLSearchParams(window.location.search).get('room') ? "online" : null);
  const [roomId, setRoomId] = useState(() => new URLSearchParams(window.location.search).get('room') || null);
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
  const [historyFirstPlayers, setHistoryFirstPlayers] = useState([]);

  const isProcessingRef = useRef(false);
  const getInviteUrl = () => `${window.location.origin}${window.location.pathname}?room=${roomId}`;
  const sortHand = (h) => [...(h || [])].sort((a, b) => a.id - b.id);

  // --- 【重要】役判定：同種3枚 or 同カテゴリー別種3枚 ---
  const isSet = (c1, c2, c3) => {
    // 1. 同種3枚 (例: カニ, カニ, カニ)
    if (c1.id === c2.id && c2.id === c3.id) return true;
    
    // 2. 同カテゴリー別種3枚 (例: カニ, エビ, 魚)
    // カテゴリーが同じ かつ すべてIDが異なる
    if (c1.category === c2.category && c2.category === c3.category) {
      if (c1.id !== c2.id && c2.id !== c3.id && c1.id !== c3.id) return true;
    }
    return false;
  };

  const getProcessedHand = (currentHand) => {
    if (!currentHand || currentHand.length < 3) return currentHand.map(c => ({...c, isCompleted: false}));
    
    let bestSetIds = [];

    // 再帰的に最適なセットの組み合わせを探す
    const findMaxSets = (remaining, currentSetIds) => {
      if (currentSetIds.length > bestSetIds.length) {
        bestSetIds = [...currentSetIds];
      }
      if (remaining.length < 3 || bestSetIds.length >= 9) return;

      for (let i = 0; i < remaining.length; i++) {
        for (let j = i + 1; j < remaining.length; j++) {
          for (let k = j + 1; k < remaining.length; k++) {
            if (isSet(remaining[i], remaining[j], remaining[k])) {
              const newFoundIds = [
                ...currentSetIds, 
                remaining[i].instanceId, 
                remaining[j].instanceId, 
                remaining[k].instanceId
              ];
              const nextRemaining = remaining.filter((_, idx) => idx !== i && idx !== j && idx !== k);
              findMaxSets(nextRemaining, newFoundIds);
              if (bestSetIds.length >= 9) return;
            }
          }
        }
      }
    };

    findMaxSets(currentHand, []);

    return currentHand.map(c => ({
      ...c,
      isCompleted: bestSetIds.includes(c.instanceId)
    }));
  };

  const checkWin = (currentHand) => {
    const processed = getProcessedHand(currentHand);
    return processed.filter(c => c.isCompleted).length >= 9;
  };

  const calculateScore = (finalHand, isWinner) => {
    const processed = getProcessedHand(finalHand);
    const completedCards = processed.filter(c => c.isCompleted);
    let score = isWinner ? 25 : 0;

    // セットごとにスコア加算 (3枚1組でループ)
    // バックトラッキングで得られた完成カードを3枚ずつチェック
    for (let i = 0; i < completedCards.length; i += 3) {
      const s = completedCards.slice(i, i + 3);
      if (s.length === 3) {
        if (s[0].id === s[1].id) score += 25; // 同種セット
        else score += 15; // 同カテゴリーセット
      }
    }
    return { total: score };
  };

  // --- CPU思考ロジック ---
  const cpuThink = (currentHand) => {
    let bestDiscardIdx = 0;
    let minUseless = 999;

    currentHand.forEach((_, idx) => {
      const testHand = currentHand.filter((__, i) => i !== idx);
      const processed = getProcessedHand(testHand);
      const uselessCount = processed.filter(c => !c.isCompleted).length;
      
      if (uselessCount < minUseless) {
        minUseless = uselessCount;
        bestDiscardIdx = idx;
      }
    });
    return bestDiscardIdx;
  };

  const finalizeGameScores = (winnerId = null, winningHand = null) => {
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
      if (currentData.round >= 3) currentData.showFinalResult = true;
      return currentData;
    });
  };

  const startAction = useCallback(async (resetGame = false) => {
    const fullDeck = [];
    CARD_TYPES.forEach(type => { for(let i=0; i<5; i++) fullDeck.push({...type, instanceId: Math.random()}); });
    fullDeck.sort(() => Math.random() - 0.5);

    const roomRef = ref(db, `rooms/${roomId}`);
    runTransaction(roomRef, (currentData) => {
      if (!currentData) return;
      const pIds = Object.keys(currentData.players).filter(id => !id.startsWith("cpu_"));
      const allIds = [...pIds];
      while(allIds.length < 4) allIds.push(`cpu_${allIds.length}`);

      const newPlayers = {};
      allIds.forEach(id => {
        newPlayers[id] = { 
          ...currentData.players[id], 
          name: id.startsWith("cpu") ? `CPU ${id.split('_')[1]}` : currentData.players[id].name,
          hand: sortHand(fullDeck.splice(0, 8)), 
          score: resetGame ? 0 : (currentData.players[id]?.score || 0),
          isCpu: id.startsWith("cpu")
        };
      });

      const history = resetGame ? [] : (currentData.historyFirstPlayers || []);
      const nextFirstIdx = (history.length === 0) ? Math.floor(Math.random() * 4) : (history[history.length - 1] + 1) % 4;
      
      currentData.players = newPlayers;
      currentData.deck = fullDeck;
      currentData.slots = [null, null, null, null];
      currentData.turn = nextFirstIdx;
      currentData.hasDrawn = false;
      currentData.status = "playing";
      currentData.round = resetGame ? 1 : (currentData.round || 1) + 1;
      currentData.lastRoundHands = null;
      currentData.showFinalResult = false;
      currentData.historyFirstPlayers = [...history, nextFirstIdx];
      return currentData;
    });
  }, [roomId]);

  useEffect(() => {
    if (gameMode !== "online" || !roomId) return;
    return onValue(ref(db, `rooms/${roomId}`), (s) => {
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
      setShowFinalResult(d.showFinalResult || false);
    });
  }, [gameMode, roomId]);

  useEffect(() => {
    if (gameStatus !== "playing" || isProcessingRef.current) return;
    const pIds = Object.keys(players);
    if (pIds.length < 4) return;
    const currentPlayerId = pIds[turn];
    if (!players[currentPlayerId]?.isCpu) return;
    if (myId !== pIds[0]) return; 

    const runCpuTurn = async () => {
      isProcessingRef.current = true;
      await new Promise(r => setTimeout(r, 1000));
      const cpuHand = players[currentPlayerId].hand || [];
      
      if (!hasDrawn) {
        const newDeck = [...deck];
        if (newDeck.length === 0) { finalizeGameScores(null, []); return; }
        const picked = newDeck.pop();
        const nextHand = sortHand([...cpuHand, picked]);
        if (checkWin(nextHand)) finalizeGameScores(currentPlayerId, nextHand);
        else update(ref(db, `rooms/${roomId}`), { deck: newDeck, [`players/${currentPlayerId}/hand`]: nextHand, hasDrawn: true });
      } else {
        const discardIdx = cpuThink(cpuHand);
        const newHand = [...cpuHand];
        const discarded = newHand.splice(discardIdx, 1)[0];
        update(ref(db, `rooms/${roomId}`), { 
          [`players/${currentPlayerId}/hand`]: sortHand(newHand), 
          [`slots/${turn}`]: discarded, 
          turn: (turn + 1) % 4, hasDrawn: false 
        });
      }
      isProcessingRef.current = false;
    };
    runCpuTurn();
  }, [turn, hasDrawn, gameStatus, players, deck]);

  const drawAction = () => {
    const pIds = Object.keys(players);
    if (turn !== pIds.indexOf(myId) || hasDrawn) return;
    const newDeck = [...deck];
    const picked = newDeck.pop();
    const newHand = sortHand([...(players[myId].hand || []), picked]);
    if (checkWin(newHand)) finalizeGameScores(myId, newHand);
    else update(ref(db, `rooms/${roomId}`), { deck: newDeck, [`players/${myId}/hand`]: newHand, hasDrawn: true });
  };

  const discardAction = (idx) => {
    const pIds = Object.keys(players);
    if (turn !== pIds.indexOf(myId) || !hasDrawn) return;
    const curH = [...(players[myId].hand || [])];
    const discarded = curH.splice(idx, 1)[0];
    update(ref(db, `rooms/${roomId}`), { [`players/${myId}/hand`]: sortHand(curH), [`slots/${turn}`]: discarded, turn: (turn + 1) % 4, hasDrawn: false });
  };

  const pickFromSlotAction = (idx) => {
    const pIds = Object.keys(players);
    if (turn !== pIds.indexOf(myId) || hasDrawn || !slots[idx]) return;
    runTransaction(ref(db, `rooms/${roomId}`), (d) => {
      if (!d || !d.slots[idx]) return;
      const picked = d.slots[idx]; d.slots[idx] = null;
      const newHand = sortHand([...(d.players[myId].hand || []), picked]);
      if (checkWin(newHand)) { d.players[myId].hand = newHand; setTimeout(() => finalizeGameScores(myId, newHand), 100); }
      else { d.players[myId].hand = newHand; d.hasDrawn = true; }
      return d;
    });
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

  if (!isJoined) return (
    <div className="game-container">
      <div className="start-screen">
        <h1 className="title-large">🍲 Hotpot Game</h1>
        <h2 className="section-title">プレイヤー登録</h2>
        <input type="text" value={playerName} onChange={(e) => setPlayerName(e.target.value)} className="name-input-large" placeholder="名前を入力" />
        <button onClick={async () => {
          if (!playerName.trim()) return;
          const rId = roomId || Math.random().toString(36).substring(2,7);
          if (!roomId) { setRoomId(rId); window.history.pushState({}, '', `?room=${rId}`); }
          const pRef = push(ref(db, `rooms/${rId}/players`));
          setMyId(pRef.key);
          await set(pRef, { name: playerName, hand: [], score: 0 });
          onDisconnect(pRef).remove(); setIsJoined(true); setGameMode("online");
        }} className="mega-button">参加する</button>
      </div>
    </div>
  );

  const pIds = Object.keys(players);
  const mIdx = pIds.indexOf(myId);
  const curHand = players[myId]?.hand || [];
  const currentRank = pIds.map(id => ({ ...players[id], isMe: id === myId })).sort((a,b)=>b.score-a.score);

  return (
    <div className="game-container">
      <div className="top-ui-bar">
        <div className="round-badge-new">Round {round}/3</div>
        <div className="invite-link-box" onClick={() => { navigator.clipboard.writeText(getInviteUrl()); alert("コピーしました"); }}>🔗 URLをコピー</div>
      </div>

      {gameStatus === "waiting" ? (
        <div className="start-screen centered">
          <div className="waiting-card">
            <h2>待機中 ({pIds.length}/4)</h2>
            <div className="p-list">{pIds.map(id => <div key={id} className="p-list-item">{players[id].name}</div>)}</div>
            {mIdx === 0 && <button onClick={() => startAction(true)} className="mega-button">ゲーム開始</button>}
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
                  <div className={`deck ${(!hasDrawn && turn===mIdx) ? 'can-draw' : ''}`} onClick={drawAction}>山札 ({deck.length})</div>
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
            <div className="win-actions">{mIdx === 0 && <button onClick={() => startAction(false)} className="mega-button">次へ</button>}</div>
          </div>
        </div>
      )}

      {showFinalResult && (
        <div className="win-overlay final-bg">
          <div className="final-card">
            <h1 className="final-title">🏆 最終結果 🏆</h1>
            <div className="final-rank-list">{currentRank.map((r, i) => (
              <div key={i} className={`final-rank-item rank-${i+1} ${r.isMe?'me':''}`}>
                <span>{i+1}</span><span>{r.name}</span><span>{r.score}pt</span>
              </div>
            ))}</div>
            {mIdx === 0 && <button onClick={() => startAction(true)} className="mega-button restart-btn">もう一杯！</button>}
          </div>
        </div>
      )}
    </div>
  );
}
export default App;
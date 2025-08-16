console.log("Монополия — игровое поле запущено");

function rollDice() {
  const dice1 = Math.floor(Math.random() * 6) + 1;
  const dice2 = Math.floor(Math.random() * 6) + 1;
  const sum = dice1 + dice2;
  document.getElementById("diceResult").innerText =
    `Выпало: ${dice1} и ${dice2} (сумма ${sum})`;
}

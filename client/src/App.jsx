import { AccountList } from "./components/AccountList.jsx";
import "./App.css";

export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>Ledgerly</h1>
        <p className="muted">Your personal ledger</p>
      </header>
      <main>
        <AccountList />
      </main>
    </div>
  );
}

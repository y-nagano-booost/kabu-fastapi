import { BrowserRouter, Routes, Route } from "react-router-dom"
import Home from "./pages/Home"
import StockDetail from "./pages/StockDetail"

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/stocks/:id" element={<StockDetail />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
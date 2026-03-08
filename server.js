const express = require('express');
const multer = require('multer');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Ładujemy dotenv tylko lokalnie
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.use(express.static('public'));

app.post('/solve', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "Wgraj zdjęcie!" });

        const { level, subject } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        // Personalizacja zachowania AI pod przedmiot
        const prompts = {
            matematyka: "Jesteś nauczycielem matematyki. Rozwiąż zadanie krok po kroku. Używaj $...$ dla wzorów.",
            polski: "Jesteś polonistą. Przeanalizuj tekst, sprawdź błędy lub zinterpretuj lekturę. Pisz przejrzyście.",
            fizyka: "Jesteś fizykiem. Wypisz dane, szukane, wzory i obliczenia. Pamiętaj o jednostkach!",
            inne: "Jesteś wszechstronnym nauczycielem. Pomóż rozwiązać zadanie ze zdjęcia w sposób edukacyjny."
        };

        const basePrompt = prompts[subject] || prompts.inne;
        const finalPrompt = `${basePrompt} Poziom trudności: ${level}. 
        ZASADY: 
        1. Wszystkie wzory i liczby z pierwiastkami/potęgami MUSZĄ być w dolarach $...$.
        2. Najważniejsze kroki i WYNIK KOŃCOWY bierz zawsze w podwójne gwiazdki i dolary, np. **$x = 5$**. To bardzo ważne dla czytelności!
        3. Pisz po polsku, zachęcająco i jasno.`;

        const result = await model.generateContent([
            finalPrompt,
            { inlineData: { data: req.file.buffer.toString("base64"), mimeType: req.file.mimetype } }
        ]);

        const response = await result.response;
        res.json({ result: response.text() });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 CloudSolve działa na porcie ${PORT}`));

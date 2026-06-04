require('dotenv').config()
const express = require('express')
const cors = require('cors')

const app = express()
app.use(cors())
app.use(express.json())

app.use('/auth', require('./routes/auth'))
app.use('/clients', require('./routes/clients'))
app.use('/carte', require('./routes/carte'))
app.use('/inscription', require('./routes/inscription'))
app.use('/notifications', require('./routes/notifications'))
app.use('/stats', require('./routes/stats'))
app.use('/cron', require('./routes/cron'))

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`Serveur démarré sur le port ${PORT}`))

import corsAnywhere from 'cors-anywhere'

const port = parseInt(process.env.PORT ?? '8080')
corsAnywhere.createServer({}).listen(port, () => {
  console.log(`CORS proxy listening on http://localhost:${port}`)
})

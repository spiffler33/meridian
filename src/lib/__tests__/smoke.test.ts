describe('smoke', () => {
  it('runs a test', () => {
    expect(true).toBe(true)
  })

  it('has indexedDB from the fake-indexeddb shim', () => {
    expect(indexedDB).toBeDefined()
  })
})

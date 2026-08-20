import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Site } from './site'
import './styles.css'

const root = document.querySelector('#root')
if (root === null) throw new Error('缺少产品站根节点')
createRoot(root).render(<StrictMode><BrowserRouter><Site /></BrowserRouter></StrictMode>)

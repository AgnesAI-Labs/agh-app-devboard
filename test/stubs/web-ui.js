// Stand-in for @agnes/web-ui in component tests: plain elements, enough for the assistant page.
import React from 'react'
const el = (tag) => (p) => React.createElement(tag, { disabled: p?.disabled, type: p?.htmlType, onClick: p?.onClick }, p?.children)
const none = () => null
export const Banner = el('div')
export const Button = el('button')
export const Badge = none
export const Field = none
export const PageHeader = none
export const PushStack = none
export const Segmented = none
export const Select = none
export const Table = none
export const usePushStack = () => ({})

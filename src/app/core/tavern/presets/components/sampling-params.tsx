'use client'

import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Input } from '@/components/ui/input'
import { SamplingParams as SamplingParamsType } from '@/lib/tavern/preset-types'

interface SamplingParamsProps {
  params: SamplingParamsType
  onChange: (params: SamplingParamsType) => void
}

interface ParamConfig {
  key: keyof SamplingParamsType
  label: string
  description: string
  min: number
  max: number
  step: number
  decimals: number
}

const PARAM_CONFIGS: ParamConfig[] = [
  {
    key: 'temperature',
    label: '温度',
    description: '控制随机性，值越高输出越随机',
    min: 0,
    max: 2,
    step: 0.01,
    decimals: 2,
  },
  {
    key: 'topP',
    label: 'Top P',
    description: '核采样，只考虑概率累计达到此值的词',
    min: 0,
    max: 1,
    step: 0.01,
    decimals: 2,
  },
  {
    key: 'topK',
    label: 'Top K',
    description: '只考虑概率最高的 K 个词',
    min: 0,
    max: 500,
    step: 1,
    decimals: 0,
  },
  {
    key: 'minP',
    label: 'Min P',
    description: '过滤概率低于此值乘以最高概率的词',
    min: 0,
    max: 1,
    step: 0.01,
    decimals: 2,
  },
  {
    key: 'topA',
    label: 'Top A',
    description: '基于最高概率的自适应采样',
    min: 0,
    max: 1,
    step: 0.01,
    decimals: 2,
  },
  {
    key: 'frequencyPenalty',
    label: '频率惩罚',
    description: '惩罚已出现词的频率',
    min: -2,
    max: 2,
    step: 0.01,
    decimals: 2,
  },
  {
    key: 'presencePenalty',
    label: '存在惩罚',
    description: '惩罚已出现过的词',
    min: -2,
    max: 2,
    step: 0.01,
    decimals: 2,
  },
  {
    key: 'repetitionPenalty',
    label: '重复惩罚',
    description: '惩罚重复的词和短语',
    min: 1,
    max: 2,
    step: 0.01,
    decimals: 2,
  },
]

export function SamplingParams({ params, onChange }: SamplingParamsProps) {
  const handleChange = (key: keyof SamplingParamsType, value: number) => {
    onChange({ ...params, [key]: value })
  }

  return (
    <div className="space-y-6">
      {PARAM_CONFIGS.map((config) => (
        <ParamSlider
          key={config.key}
          config={config}
          value={params[config.key]}
          onChange={(value) => handleChange(config.key, value)}
        />
      ))}
    </div>
  )
}

interface ParamSliderProps {
  config: ParamConfig
  value: number
  onChange: (value: number) => void
}

function ParamSlider({ config, value, onChange }: ParamSliderProps) {
  const handleSliderChange = (values: number[]) => {
    onChange(values[0])
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = parseFloat(e.target.value)
    if (!isNaN(newValue)) {
      // 限制范围
      const clampedValue = Math.max(config.min, Math.min(config.max, newValue))
      onChange(clampedValue)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm">{config.label}</Label>
        <Input
          type="number"
          value={value.toFixed(config.decimals)}
          onChange={handleInputChange}
          className="w-20 h-7 text-right text-sm"
          step={config.step}
          min={config.min}
          max={config.max}
        />
      </div>
      <Slider
        value={[value]}
        onValueChange={handleSliderChange}
        min={config.min}
        max={config.max}
        step={config.step}
        className="w-full"
      />
      <p className="text-xs text-muted-foreground">{config.description}</p>
    </div>
  )
}

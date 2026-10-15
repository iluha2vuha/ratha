from fastapi import APIRouter
from app.weather import WeatherRequest, get_weather

router = APIRouter(tags=['weather'])


@router.post('/weather')
def route_weather(payload: WeatherRequest) -> dict:
    return get_weather(payload)
